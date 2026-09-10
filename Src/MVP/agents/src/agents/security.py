"""Security Agent -- operazioni SECURITY_OWASP e SECURITY_POLICY.

Analizza il codice cercando vulnerabilita' OWASP Top 10 e violazioni di policy.
Per SECURITY_OWASP la ricerca e' in due fasi: prima Semgrep (deterministico,
richiamo alto), poi l'LLM che giudica ogni candidato e cerca cio' che una
regola statica non vede.
"""

import logging
from typing import Any

from ..config import settings
from ..github_toolset import GitHubToolset
from ..models import (
    Block,
    FindingBlock,
    PolicyViolationBlock,
    Proposal,
    SastFindingBlock,
    SastSummaryBlock,
)
from ..sast_analyzer import SASTAnalyzer
from ._base import extract_json, load_prompt_template, render_prompt

logger = logging.getLogger(__name__)

# Estensioni per cui esiste un ruleset Semgrep in sast_analyzer: tenerle
# allineate evita di scaricare file che poi nessuna regola guarderebbe.
_SUPPORTED_EXTS = (".ts", ".js", ".jsx", ".tsx", ".py", ".java", ".go", ".rb")


class ContextResourceMissingError(Exception):
    """Specific exception mapped to ErrorKind.CONTEXT_RESOURCE_MISSING."""

    def __init__(self, message: str):
        """Initializes the exception.

        Args:
            message (str): The error message.
        """
        self.error_type = "CONTEXT_RESOURCE_MISSING"
        super().__init__(message)


class ContextResourceInvalidError(Exception):
    """Specific exception mapped to ErrorKind.CONTEXT_RESOURCE_INVALID."""

    def __init__(self, message: str):
        """Initializes the exception.

        Args:
            message (str): The error message.
        """
        self.error_type = "CONTEXT_RESOURCE_INVALID"
        super().__init__(message)


class SecurityLoader:
    """Loads the context (code and policy) via the Facade."""

    def __init__(
        self, operation: str = "SECURITY_OWASP", sast_analyzer: SASTAnalyzer | None = None
    ):
        """Initializes the loader.

        Args:
            operation (str): The operation code. Defaults to 'SECURITY_OWASP'.
            sast_analyzer (SASTAnalyzer | None): Analizzatore statico da usare
                prima dell'LLM. Iniettato invece che costruito qui per poterlo
                sostituire nei test e per lasciare a main.py l'unica decisione
                su se la funzionalita' e' attiva.
        """
        self.operation = operation
        self._sast = sast_analyzer

    async def load(
        self,
        context_ref: Any,
        toolset: GitHubToolset,
        agent_payload: dict | None = None,
    ) -> dict:
        """Loads the security context by resolving the file tree and policy.

        Args:
            context_ref (Any): The context reference with repository details.
            toolset (GitHubToolset): The toolset to interact with GitHub.
            agent_payload (dict, optional): The payload from the agent. Defaults to None.

        Returns:
            dict: The loaded context containing policy and files.

        Raises:
            ContextResourceInvalidError: If no supported files are found in the scope.
            ContextResourceMissingError: If POLICY.md is missing during a POLICY_SCAN.
        """
        owner = context_ref.repoOwner
        repo = context_ref.repoName
        sha = context_ref.resolvedSha
        scope_type = getattr(context_ref, "scopeType", "FULL_REPOSITORY")
        paths = getattr(context_ref, "paths", [])

        tree_response = await toolset.read_tree(owner, repo, sha)
        nodes = tree_response.get("nodes", [])

        files_to_scan = []

        for n in nodes:
            if n["type"] == "file" and n["path"].endswith(_SUPPORTED_EXTS):
                if scope_type == "FULL_REPOSITORY":
                    files_to_scan.append(n["path"])
                else:
                    if any(n["path"].startswith(p) for p in paths):
                        files_to_scan.append(n["path"])

        if not files_to_scan:
            raise ContextResourceInvalidError(
                "No source files found for the security scan in the selected scope."
            )

        tree_str = (
            "Supported files available in the requested scope "
            "(use the read_file tool to inspect them):\n"
        )
        tree_str += "\n".join(f"- {f}" for f in files_to_scan)

        policy_node = next((n for n in nodes if n["path"].lower() == "policy.md"), None)

        if policy_node is None and self.operation == "SECURITY_POLICY":
            raise ContextResourceMissingError(
                "POLICY.md not found in the repository: cannot execute Policy Scan without "
                "explicit directives."
            )

        policy_content = "No specific policy provided. Apply standard OWASP rules."
        if policy_node:
            p_resp = await toolset.read_file(owner, repo, sha, policy_node["path"])
            policy_content = p_resp.get("content", policy_content)

        sast_findings, sast_summary, sast_section = await self._run_sast(
            toolset, owner, repo, sha, files_to_scan
        )

        await toolset.report_progress(stage="security_context_loaded", percent=30)

        return {
            "policy": policy_content,
            "files": tree_str,
            "sast_section": sast_section,
            "sast_findings": sast_findings,
            "sast_summary": sast_summary,
        }

    async def _run_sast(
        self,
        toolset: GitHubToolset,
        owner: str,
        repo: str,
        sha: str,
        files_to_scan: list[str],
    ) -> tuple[list[SastFindingBlock], SastSummaryBlock | None, str]:
        """Esegue la scansione statica, se prevista per questa operazione.

        Solo per SECURITY_OWASP: SECURITY_POLICY verifica le regole scritte nel
        POLICY.md del repository, che nessun ruleset generico conosce.

        Args:
            toolset (GitHubToolset): Facade verso il backend.
            owner (str): Proprietario del repository.
            repo (str): Nome del repository.
            sha (str): Commit a cui e' ancorato il contesto.
            files_to_scan (list[str]): Percorsi dei file nello scope.

        Returns:
            tuple: I finding, il riepilogo (None se il motore non e' stato
            eseguibile) e la sezione di prompt da sottoporre all'LLM.
        """
        if not (self._sast and self.operation == "SECURITY_OWASP"):
            return [], None, ""

        # Ogni file e' un giro HTTP verso la facade: senza tetto, su un
        # repository grande la sola raccolta esaurirebbe il budget
        # dell'operazione prima ancora di interrogare il modello.
        selected = files_to_scan[: settings.sast_max_files]
        if len(files_to_scan) > len(selected):
            logger.warning(
                "SAST limitato ai primi %d file su %d (SAST_MAX_FILES)",
                len(selected),
                len(files_to_scan),
            )

        file_contents: dict[str, str] = {}
        for path in selected:
            try:
                resp = await toolset.read_file(owner, repo, sha, path)
            except Exception as exc:  # noqa: BLE001 - un file illeggibile non ferma la scansione
                logger.warning("SAST: impossibile leggere %s (%s)", path, exc)
                continue
            content = resp.get("content", "")
            if content:
                file_contents[path] = content

        findings, summary = await self._sast.analyze(file_contents)
        if summary is None:
            # Motore non disponibile: nessuna sezione SAST, ne' nel prompt ne'
            # nel report. Un riepilogo a zero si leggerebbe come "nessuna
            # vulnerabilita'" invece che "analisi non eseguita".
            return [], None, ""

        logger.info(
            "SAST completato: %d finding (esclusi=%d, timeout=%s)",
            summary.totalFindings,
            summary.cappedFindings,
            summary.timedOut,
        )
        return findings, summary, self._sast.format_for_prompt(findings, summary)


class OwaspScanProfile:
    """Handles prompt generation and output parsing for the OWASP scan."""

    agent = "security"
    operation = "SECURITY_OWASP"
    max_tool_rounds = settings.max_tool_rounds
    uses_tools = True

    def build_prompt(self, ctx: dict) -> tuple[str, str]:
        """Builds the system and user prompts.

        Args:
            ctx (dict): The context containing the policy and file tree.

        Returns:
            Tuple[str, str]: The generated prompts.
        """
        template_data = load_prompt_template("security", "owasp_scan")
        # `sast` e' una variabile a se' e non un'aggiunta in testa a `files`:
        # il template la colloca dove serve e, soprattutto, spiega al modello
        # che quella sezione va giudicata (sast_verdicts) e non solo letta.
        # Vuota quando la scansione non e' stata eseguita.
        return render_prompt(
            template_data,
            policy=ctx["policy"],
            files=ctx["files"],
            sast=ctx.get("sast_section", ""),
        )

    def parse_output(
        self, raw: str, ctx: dict | None = None
    ) -> tuple[list[Block], Proposal | None]:
        """Interpreta l'output del modello.

        Produce tre gruppi di blocchi: i finding di Semgrep con il verdetto che
        il modello ha dato a ciascuno, il riepilogo aggiornato della scansione,
        e i finding che il modello ha trovato per conto proprio.

        Args:
            raw (str): The raw string output from the model.
            ctx (dict, optional): Il contesto caricato, da cui si recuperano i
                finding SAST prodotti prima dell'invocazione.

        Returns:
            Tuple[List[Block], Optional[Proposal]]: The parsed blocks and an optional proposal.
        """
        data = extract_json(raw)
        ctx = ctx or {}
        blocks: list[Block] = self._apply_sast_verdicts(data, ctx)
        order_offset = len(blocks)

        for order, item in enumerate(data.get("findings", [])):
            rem_data = item.get("remediation", {})

            if isinstance(rem_data, dict):
                rem_kind = rem_data.get("kind", "").upper()
                if rem_kind == "SNIPPET":
                    remediation = {
                        "kind": "SNIPPET",
                        "language": rem_data.get("language", ""),
                        "code": rem_data.get("code", ""),
                    }
                else:
                    text_fallback = rem_data.get("text", "No remediation provided")
                    remediation = {
                        "kind": "TEXT",
                        "text": rem_data.get("markdown", text_fallback),
                    }
            else:
                remediation = {"kind": "TEXT", "text": str(rem_data)}

            # INFO non viene piu' degradato a LOW: il dominio condiviso di
            # Severity lo prevede (shared/src/types.ts), e appiattirlo faceva
            # sparire la distinzione fra "segnalazione" e "problema minore".
            raw_severity = str(item.get("severity", "MEDIUM")).upper()

            end_line = item.get("end_line")

            blocks.append(
                FindingBlock(
                    order=order_offset + order,
                    category=str(item.get("category", "Uncategorized")),
                    severity=raw_severity,
                    filePath=str(item.get("file", "unknown")),
                    lineStart=int(item.get("start_line", 1)),
                    lineEnd=int(end_line) if end_line else None,
                    description=str(item.get("message", "")),
                    remediation=remediation,
                )
            )
        return blocks, None

    @staticmethod
    def _apply_sast_verdicts(data: dict, ctx: dict) -> list[Block]:
        """Applica ai finding di Semgrep il giudizio espresso dal modello.

        Il modello risponde con un array `sast_verdicts`, ciascuno riferito a un
        finding tramite `rule_id` **e** posizione. Il solo rule_id non basta:
        la stessa regola puo' essere violata in piu' punti, e appaiare per
        regola assegnerebbe a tutte le occorrenze il verdetto dato a una sola.
        Un finding che il modello non nomina resta NEEDS_REVIEW, che e' la
        risposta onesta: nessuno l'ha guardato.

        Args:
            data (dict): L'output del modello, gia' decodificato.
            ctx (dict): Il contesto caricato, con i finding e il riepilogo SAST.

        Returns:
            list[Block]: I finding SAST aggiornati piu' il riepilogo.
        """
        findings: list[SastFindingBlock] = ctx.get("sast_findings") or []
        summary: SastSummaryBlock | None = ctx.get("sast_summary")
        if not findings or summary is None:
            return []

        by_key: dict[tuple[str, str, int], tuple[str, str | None]] = {}
        by_rule: dict[str, tuple[str, str | None]] = {}
        for item in data.get("sast_verdicts", []):
            rule_id = str(item.get("rule_id", ""))
            if not rule_id:
                continue
            verdict = str(item.get("verdict", "NEEDS_REVIEW")).upper()
            if verdict not in ("CONFIRMED", "FALSE_POSITIVE", "NEEDS_REVIEW"):
                verdict = "NEEDS_REVIEW"
            remediation = item.get("remediation")
            remediation = str(remediation) if remediation else None

            file_path = str(item.get("file", "") or item.get("file_path", ""))
            line = item.get("line")
            if file_path and line is not None:
                try:
                    by_key[(rule_id, file_path, int(line))] = (verdict, remediation)
                except (TypeError, ValueError):
                    pass
            # Ripiego per quando il modello riporta solo la regola: si applica
            # unicamente se quella regola compare una volta sola.
            by_rule.setdefault(rule_id, (verdict, remediation))

        rule_counts: dict[str, int] = {}
        for finding in findings:
            rule_counts[finding.ruleId] = rule_counts.get(finding.ruleId, 0) + 1

        blocks: list[Block] = []
        for position, finding in enumerate(findings):
            key = (finding.ruleId, finding.filePath, finding.lineStart)
            match = by_key.get(key)
            if match is None and rule_counts[finding.ruleId] == 1:
                match = by_rule.get(finding.ruleId)
            if match is not None:
                finding.verdict, remediation = match  # type: ignore[assignment]
                if remediation:
                    finding.llmRemediation = remediation
            # Posizione 0 e' del riepilogo, che viene anteposto qui sotto.
            finding.order = position + 1
            blocks.append(finding)

        updated = summary.model_copy(
            update={
                "order": 0,
                "confirmedFindings": sum(1 for f in findings if f.verdict == "CONFIRMED"),
                "falsePositives": sum(1 for f in findings if f.verdict == "FALSE_POSITIVE"),
                "needsReview": sum(1 for f in findings if f.verdict == "NEEDS_REVIEW"),
            }
        )
        # Il riepilogo va in testa al report: e' il blocco che dice se la lista
        # che segue e' completa.
        return [updated, *blocks]


class SecurityPolicyProfile:
    """Handles prompt generation and output parsing for the Policy-as-Code scan."""

    agent = "security"
    operation = "SECURITY_POLICY"
    max_tool_rounds = settings.max_tool_rounds
    uses_tools = True

    def build_prompt(self, ctx: dict) -> tuple[str, str]:
        """Builds the system and user prompts.

        Args:
            ctx (dict): The context containing the policy and file tree.

        Returns:
            Tuple[str, str]: The generated prompts.
        """
        template_data = load_prompt_template("security", "policy_scan")
        return render_prompt(template_data, policy=ctx["policy"], files=ctx["files"])

    def parse_output(
        self, raw: str, ctx: dict | None = None
    ) -> tuple[list[Block], Proposal | None]:
        """Parses the raw output into PolicyViolationBlocks.

        Args:
            raw (str): The raw string output from the model.
            ctx (dict, optional): The context containing additional information.

        Returns:
            Tuple[List[Block], Optional[Proposal]]: The parsed blocks and an optional proposal.
        """
        data = extract_json(raw)
        blocks: list[Block] = []

        for order, item in enumerate(data.get("findings", [])):
            rem_data = item.get("remediation", {})

            if isinstance(rem_data, dict):
                rem_kind = rem_data.get("kind", "").upper()
                if rem_kind == "SNIPPET":
                    remediation = {
                        "kind": "SNIPPET",
                        "language": rem_data.get("language", ""),
                        "code": rem_data.get("code", ""),
                    }
                else:
                    text_fallback = rem_data.get("text", "No remediation provided")
                    remediation = {
                        "kind": "TEXT",
                        "text": rem_data.get("markdown", text_fallback),
                    }
            else:
                remediation = {"kind": "TEXT", "text": str(rem_data)}

            start_line = item.get("start_line")
            end_line = item.get("end_line")

            blocks.append(
                PolicyViolationBlock(
                    order=order,
                    ruleId=str(item.get("ruleId", "unknown")),
                    ruleText=str(item.get("ruleText", "")),
                    filePath=str(item.get("filePath", "unknown")),
                    lineStart=int(start_line) if start_line else None,
                    lineEnd=int(end_line) if end_line else None,
                    severity=str(item.get("severity", "MEDIUM")).upper(),
                    explanation=str(item.get("explanation", "")),
                    remediation=remediation,
                )
            )
        return blocks, None

