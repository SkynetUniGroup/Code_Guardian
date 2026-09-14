"""Analisi statica (SAST) con Semgrep.

Prima fase dell'operazione SECURITY_OWASP: uno strumento deterministico trova i
candidati, l'LLM li giudica uno per uno (OwaspScanProfile.parse_output). Il
punto della combinazione e' che nessuno dei due basta da solo — Semgrep ha
richiamo alto e molti falsi positivi, il modello sa scartarli ma non sa cercare
in modo esaustivo.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from .config import settings
from .models import SEMGREP_SEVERITY_MAP, SastFindingBlock, SastSummaryBlock

logger = logging.getLogger(__name__)

# Ordine di priorita' con cui si tagliano i finding quando superano il tetto:
# gli ERROR arrivano al modello prima dei WARNING, i WARNING prima degli INFO.
_SEVERITY_RANK = {"ERROR": 0, "WARNING": 1, "INFO": 2}

_OWASP_RULESETS: list[str] = [
    "p/owasp-top-ten",
]

_LANGUAGE_RULESETS: dict[str, list[str]] = {
    "py": ["p/python"],
    "js": ["p/javascript"],
    "ts": ["p/typescript"],
    "jsx": ["p/javascript"],
    "tsx": ["p/typescript"],
    "java": ["p/java"],
    "go": ["p/golang"],
    "rb": ["p/ruby"],
}

_MAX_SNIPPET_CHARS = 300


class SASTAnalyzer:
    """Esegue Semgrep su un insieme di file e ne normalizza i risultati."""

    def __init__(
        self, timeout_s: int | None = None, max_findings: int | None = None
    ) -> None:
        """Inizializza l'analizzatore.

        Args:
            timeout_s (int | None): Tetto al tempo della scansione. Default:
                settings.semgrep_timeout_s.
            max_findings (int | None): Quanti finding sottoporre al modello.
                Default: settings.sast_max_findings_llm.
        """
        self._timeout_s = timeout_s or settings.semgrep_timeout_s
        self._max_findings = max_findings or settings.sast_max_findings_llm

    async def analyze(
        self, files: dict[str, str]
    ) -> tuple[list[SastFindingBlock], SastSummaryBlock | None]:
        """Analizza i file e restituisce i finding con il relativo riepilogo.

        Args:
            files (dict[str, str]): Contenuto dei file, indicizzato per percorso
                relativo alla radice del repository.

        Returns:
            tuple[list[SastFindingBlock], SastSummaryBlock | None]: I finding
            (gia' deduplicati, ordinati per severita' e limitati al tetto) e il
            riepilogo. Il riepilogo e' **None** quando il motore non e' stato
            eseguibile: in quel caso il report non deve contenere alcuna sezione
            SAST, perche' un riepilogo con zero finding si leggerebbe come
            "nessuna vulnerabilita' trovata" invece che "analisi non eseguita".
        """
        if not files:
            return [], self._empty_summary()

        start_ms = int(time.time() * 1000)
        timed_out = False
        raw_findings: list[dict[str, Any]] = []

        with tempfile.TemporaryDirectory(prefix="cg_sast_") as tmpdir:
            written = self._write_files(tmpdir, files)
            if not written:
                logger.warning("Nessun file scrivibile per la scansione SAST")
                return [], self._empty_summary()

            extensions = {Path(p).suffix.lstrip(".") for p in written}
            rulesets = self._build_rulesets(extensions)

            try:
                raw_findings = await asyncio.wait_for(
                    self._run_semgrep(tmpdir, rulesets),
                    timeout=self._timeout_s,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "Semgrep ha superato %ds — si prosegue con risultati parziali",
                    self._timeout_s,
                )
                timed_out = True
            except FileNotFoundError:
                # Il binario non e' installato nell'immagine. Non e' un errore
                # del task: l'operazione prosegue con il solo LLM, che e' il
                # comportamento che si aveva prima che il SAST esistesse.
                logger.error(
                    "Binario 'semgrep' non trovato: analisi statica saltata. "
                    "Installalo (pip install semgrep) o imposta ENABLE_SAST_SEMGREP=false."
                )
                return [], None
            except OSError as exc:
                logger.error("Impossibile eseguire Semgrep: %s — analisi statica saltata", exc)
                return [], None

            # Il parsing sta dentro il `with`: i percorsi dei risultati sono
            # assoluti dentro tmpdir e vanno resi relativi finche' la directory
            # esiste ancora.
            findings = self._parse_findings(raw_findings, tmpdir)

        duration_ms = int(time.time() * 1000) - start_ms

        findings = self._sort_by_severity(self._dedup(findings))

        capped = max(0, len(findings) - self._max_findings)
        capped_findings = findings[: self._max_findings]
        for order, finding in enumerate(capped_findings):
            finding.order = order

        summary = SastSummaryBlock(
            totalFindings=len(findings),
            # I verdetti si conoscono solo dopo il passaggio dell'LLM: qui sono
            # tutti NEEDS_REVIEW, e il riepilogo viene ricalcolato in
            # OwaspScanProfile.parse_output.
            needsReview=len(capped_findings),
            cappedFindings=capped,
            scannedFiles=len(files),
            durationMs=duration_ms,
            timedOut=timed_out,
        )

        return capped_findings, summary

    def _write_files(self, tmpdir: str, files: dict[str, str]) -> list[str]:
        """Materializza i file in una directory temporanea.

        I percorsi arrivano dall'albero di un repository che non controlliamo:
        prima di scrivere si verifica che ciascuno resti dentro tmpdir, cosi'
        che un percorso costruito ad arte (`../../etc/...`, un percorso
        assoluto) non possa far scrivere l'analizzatore fuori dalla propria
        sandbox. E' l'unico punto in cui questo servizio scrive su disco
        contenuti presi da un repository di terzi.

        Args:
            tmpdir (str): Directory temporanea di destinazione.
            files (dict[str, str]): Contenuto per percorso relativo.

        Returns:
            list[str]: I percorsi relativi effettivamente scritti.
        """
        root = Path(tmpdir).resolve()
        written: list[str] = []

        for rel_path, content in files.items():
            candidate = (root / rel_path).resolve()
            if not candidate.is_relative_to(root):
                logger.warning("Percorso fuori dalla sandbox SAST, ignorato: %s", rel_path)
                continue
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_text(content, encoding="utf-8")
            written.append(rel_path)

        return written

    def _build_rulesets(self, extensions: set[str]) -> list[str]:
        """Compone i ruleset: OWASP sempre, piu' quelli dei linguaggi presenti.

        Args:
            extensions (set[str]): Estensioni dei file da analizzare.

        Returns:
            list[str]: Ruleset senza duplicati, nell'ordine di inserimento.
        """
        rulesets = list(_OWASP_RULESETS)
        for ext in extensions:
            rulesets.extend(_LANGUAGE_RULESETS.get(ext, []))
        return list(dict.fromkeys(rulesets))

    async def _run_semgrep(self, target_dir: str, rulesets: list[str]) -> list[dict[str, Any]]:
        """Lancia Semgrep come sottoprocesso e ne raccoglie l'output JSON.

        Args:
            target_dir (str): Directory da analizzare.
            rulesets (list[str]): Ruleset da applicare.

        Returns:
            list[dict[str, Any]]: I risultati grezzi, o lista vuota.

        Raises:
            FileNotFoundError: Se il binario semgrep non e' installato.
        """
        config_args: list[str] = []
        for ruleset in rulesets:
            config_args += ["--config", ruleset]

        cmd = [
            "semgrep",
            *config_args,
            "--json",
            "--no-rewrite-rule-ids",
            "--max-target-bytes",
            "1000000",
            target_dir,
        ]

        logger.debug("Esecuzione semgrep: %s", " ".join(cmd))
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await proc.communicate()
        except asyncio.CancelledError:
            # Il timeout di wait_for cancella questa coroutine: senza terminare
            # il processo, semgrep resterebbe orfano a consumare CPU per tutta
            # la vita del container.
            proc.kill()
            await proc.wait()
            raise

        if stderr:
            logger.debug("semgrep stderr: %s", stderr.decode("utf-8", errors="replace")[:500])

        if not stdout:
            return []

        try:
            data = json.loads(stdout.decode("utf-8"))
            return data.get("results", [])
        except json.JSONDecodeError:
            logger.warning("Output JSON di semgrep non interpretabile")
            return []

    def _parse_findings(
        self, raw: list[dict[str, Any]], tmpdir: str
    ) -> list[SastFindingBlock]:
        """Converte i risultati grezzi in blocchi del contratto condiviso.

        Args:
            raw (list[dict[str, Any]]): Risultati grezzi di Semgrep.
            tmpdir (str): Directory della scansione, per rendere relativi i percorsi.

        Returns:
            list[SastFindingBlock]: I finding interpretabili; gli altri vengono
            scartati con un log, senza far fallire l'intera scansione.
        """
        findings: list[SastFindingBlock] = []
        for item in raw:
            try:
                finding = self._map_result(item, tmpdir)
                if finding:
                    findings.append(finding)
            except (KeyError, TypeError, ValueError) as exc:
                logger.debug("Risultato semgrep scartato: %s", exc)
        return findings

    def _map_result(self, item: dict[str, Any], tmpdir: str) -> SastFindingBlock | None:
        """Mappa un singolo risultato di Semgrep sul blocco del report.

        Args:
            item (dict[str, Any]): Il risultato grezzo.
            tmpdir (str): Directory della scansione.

        Returns:
            SastFindingBlock | None: Il blocco corrispondente.
        """
        extra: dict = item.get("extra", {})
        metadata: dict = extra.get("metadata", {})

        raw_severity = str(extra.get("severity") or "WARNING").upper()
        rule_severity = raw_severity if raw_severity in _SEVERITY_RANK else "WARNING"

        owasp_refs = metadata.get("owasp", [])
        if isinstance(owasp_refs, str):
            owasp_refs = [owasp_refs]
        owasp_category = owasp_refs[0] if owasp_refs else "OWASP-UNKNOWN"

        cwe_refs = metadata.get("cwe", [])
        if isinstance(cwe_refs, str):
            cwe_refs = [cwe_refs]
        cwe = cwe_refs[0] if cwe_refs else None

        message: str = str(extra.get("message", "No message")).strip()
        snippet: str = str(extra.get("lines", "")).strip()
        if len(snippet) > _MAX_SNIPPET_CHARS:
            snippet = snippet[: _MAX_SNIPPET_CHARS - 3] + "..."

        return SastFindingBlock(
            ruleId=str(item.get("check_id", "unknown")),
            owaspCategory=str(owasp_category),
            cwe=str(cwe) if cwe else None,
            severity=SEMGREP_SEVERITY_MAP.get(rule_severity, "MEDIUM"),
            ruleSeverity=rule_severity,  # type: ignore[arg-type]
            filePath=self._relative_path(str(item.get("path", "")), tmpdir),
            lineStart=int(item.get("start", {}).get("line", 0)),
            message=message,
            codeSnippet=snippet or None,
        )

    @staticmethod
    def _relative_path(path_raw: str, tmpdir: str) -> str:
        """Riporta il percorso alla radice del repository.

        Semgrep restituisce percorsi dentro la directory temporanea: lasciarli
        cosi' significherebbe mostrare all'utente `/tmp/cg_sast_xyz/src/app.py`
        e, peggio, scrivere un percorso di sistema dentro un report persistito.

        Args:
            path_raw (str): Il percorso emesso da Semgrep.
            tmpdir (str): La directory della scansione.

        Returns:
            str: Il percorso relativo al repository.
        """
        if not path_raw:
            return "unknown"
        try:
            return os.path.relpath(path_raw, tmpdir).replace(os.sep, "/")
        except ValueError:
            # Volumi diversi su Windows: non c'e' un percorso relativo possibile.
            return path_raw

    @staticmethod
    def _dedup(findings: list[SastFindingBlock]) -> list[SastFindingBlock]:
        """Tiene una sola occorrenza per (regola, file, riga).

        La chiave include la riga di proposito: la stessa regola violata in due
        punti diversi dello stesso file sono due problemi da sistemare, non uno.
        Restano fuori solo i duplicati veri, che Semgrep puo' emettere quando
        piu' ruleset contengono la stessa regola.

        Args:
            findings (list[SastFindingBlock]): I finding da deduplicare.

        Returns:
            list[SastFindingBlock]: I finding unici, nell'ordine originale.
        """
        seen: set[tuple[str, str, int]] = set()
        unique: list[SastFindingBlock] = []
        for finding in findings:
            key = (finding.ruleId, finding.filePath, finding.lineStart)
            if key not in seen:
                seen.add(key)
                unique.append(finding)
        return unique

    @staticmethod
    def _sort_by_severity(findings: list[SastFindingBlock]) -> list[SastFindingBlock]:
        """Ordina per severita' nativa di Semgrep, decrescente.

        Args:
            findings (list[SastFindingBlock]): I finding da ordinare.

        Returns:
            list[SastFindingBlock]: I finding ordinati.
        """
        return sorted(findings, key=lambda f: _SEVERITY_RANK.get(f.ruleSeverity, 99))

    @staticmethod
    def _empty_summary() -> SastSummaryBlock:
        """Riepilogo di una scansione eseguita che non ha trovato nulla.

        Returns:
            SastSummaryBlock: Riepilogo a zero.
        """
        return SastSummaryBlock(totalFindings=0)

    def format_for_prompt(
        self, findings: list[SastFindingBlock], summary: SastSummaryBlock
    ) -> str:
        """Rende i finding nella sezione di prompt che l'LLM deve giudicare.

        Args:
            findings (list[SastFindingBlock]): I finding da sottoporre.
            summary (SastSummaryBlock): Il riepilogo della scansione.

        Returns:
            str: La sezione Markdown da anteporre all'elenco dei file.
        """
        if not findings:
            return ""

        lines: list[str] = ["### Analisi SAST (Semgrep / OWASP Top Ten)\n"]
        lines.append(
            f"File analizzati: {summary.scannedFiles} | "
            f"Finding totali: {summary.totalFindings} | "
            f"Sottoposti a giudizio: {len(findings)}"
        )
        if summary.timedOut:
            lines.append("Attenzione: Semgrep ha superato il timeout, risultati parziali.\n")
        if summary.cappedFindings:
            lines.append(
                f"Attenzione: {summary.cappedFindings} finding esclusi dal limite "
                "(priorita' ERROR > WARNING > INFO).\n"
            )

        for finding in findings:
            lines.append(
                f"\n**[{finding.ruleSeverity}] {finding.ruleId}** — {finding.owaspCategory}"
                + (f" ({finding.cwe})" if finding.cwe else "")
            )
            lines.append(f"  File: `{finding.filePath}` riga {finding.lineStart}")
            lines.append(f"  {finding.message}")
            if finding.codeSnippet:
                lines.append(f"  ```\n  {finding.codeSnippet}\n  ```")

        return "\n".join(lines)
