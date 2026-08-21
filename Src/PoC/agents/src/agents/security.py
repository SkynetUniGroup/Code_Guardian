"""Agente Security -- operazione SECURITY_OWASP.
Analizza il codice sorgente alla ricerca di vulnerabilità della OWASP Top 10.
"""

from typing import Any, Tuple, List, Optional
from ..models import Proposal, FindingBlock, Block, PolicyViolationBlock, SEVERITY_ORDER
from ..github_toolset import GitHubToolset
from ._base import load_prompt_template, render_prompt, extract_json

class SecurityLoader:
    """Carica il contesto (codice e policy) via Facade."""

    def __init__(self, operation: str = "SECURITY_OWASP"):
        self.operation = operation

    async def load(self, context_ref: Any, toolset: GitHubToolset) -> dict:
        owner = context_ref.repoOwner
        repo = context_ref.repoName
        sha = context_ref.ref
        
        scope_type = getattr(context_ref, "scopeType", "FULL_REPOSITORY")
        paths = getattr(context_ref, "paths", [])
        
        # 1. Recuperiamo l'albero per far vedere all'LLM cosa c'è nel repository
        tree_response = await toolset.read_tree(owner, repo, sha)
        nodes = tree_response.get("nodes", [])
        
        # 2. Passiamo all'LLM solo i percorsi filtrati per estensione E per SCOPE
        supported_exts = (".ts", ".js", ".py")
        files_to_scan = []
        
        for n in nodes:
            if n["type"] == "file" and n["path"].endswith(supported_exts):
                if scope_type == "FULL_REPOSITORY":
                    files_to_scan.append(n["path"])
                else:
                    # Se l'utente ha selezionato cartelle/file specifici, consideriamo solo quelli
                    if any(n["path"].startswith(p) for p in paths):
                        files_to_scan.append(n["path"])
        
        if not files_to_scan:
            raise ValueError("Nessun file sorgente trovato per la scansione di sicurezza nell'ambito selezionato.")
            
        tree_str = "File supportati disponibili nell'ambito richiesto (usa il tool read_file per ispezionarli):\n"
        tree_str += "\n".join(f"- {f}" for f in files_to_scan)

        # 3. Leggiamo POLICY.md se esiste...
        policy_node = next((n for n in nodes if n["path"].lower() == "policy.md"), None)

        if policy_node is None and self.operation == "SECURITY_POLICY":
            raise ValueError(
                "POLICY.md non trovato nel repository: impossibile eseguire la Policy Scan senza direttive esplicite."
            )

        policy_content = "Nessuna policy specifica fornita. Applica regole OWASP standard."
        if policy_node:
            p_resp = await toolset.read_file(owner, repo, sha, policy_node["path"])
            policy_content = p_resp.get("content", policy_content)
        
        # Avanzamento
        await toolset.report_progress(stage="security_context_loaded", percent=30)
        
        return {
            "policy": policy_content,
            "files": tree_str,
            # TU_09 (PdQ) -- RF.30: lista strutturata (non solo la stringa per il
            # prompt) dei percorsi effettivamente ammessi nell'ambito richiesto,
            # cosi' che parse_output() possa scartare i finding su file che l'LLM
            # non avrebbe dovuto vedere (allucinati o fuori scope).
            "files_to_scan": files_to_scan,
        }

class SecurityProfile:
    """Gestisce il prompt e il parsing dell'output per l'agente Security."""
    agent = "security"
    # Le scansioni di sicurezza richiedono piu' round di read_file rispetto al
    # default globale per poter ispezionare un numero di file sufficiente a
    # una scansione affidabile.
    max_tool_rounds = 20

    def __init__(self, operation: str = "SECURITY_OWASP"):
        self.operation = operation
        self._ctx = {}

    def build_prompt(self, ctx: dict) -> tuple[str, str]: 
        template_id = "owasp_scan" if self.operation == "SECURITY_OWASP" else "policy_scan"
        template_data = load_prompt_template("security", template_id)
        
        return render_prompt(
            template_data, 
            policy=ctx["policy"], 
            files=ctx["files"]
        )

    def parse_output(self, raw: str, loaded_context: Optional[dict] = None) -> Tuple[List[Block], Optional[Proposal]]:
        data = extract_json(raw)

        blocks: List[Block] = []
        order = 0

        for item in data.get("findings", []):
            if self.operation == "SECURITY_POLICY":
                blocks.append(
                    PolicyViolationBlock(
                        order=order,
                        ruleId=str(item.get("ruleId", "unknown")),
                        ruleText=str(item.get("ruleText", "")),
                        filePath=str(item.get("filePath", "unknown")),
                        explanation=str(item.get("explanation", "")),
                        remediation=str(item.get("remediation", "Nessuna remediation fornita"))
                    )
                )
            else:
                rem_data = item.get("remediation", {})
                if isinstance(rem_data, dict):
                    if rem_data.get("kind") == "snippet":
                        remediation_str = f"```\n{rem_data.get('code', '')}\n```"
                    else:
                        remediation_str = rem_data.get("markdown", "Nessuna remediation fornita")
                else:
                    remediation_str = str(rem_data)

                blocks.append(
                    FindingBlock(
                        order=order,
                        owaspCategory=str(item.get("category", "Uncategorized")),
                        severity=item.get("severity", "medium").lower(),
                        filePath=str(item.get("file", "unknown")),
                        startLine=int(item.get("start_line", 1)),
                        endLine=int(item.get("end_line", 1)),
                        explanation=str(item.get("message", "")),
                        remediation=remediation_str
                    )
                )
            order += 1

        if self.operation != "SECURITY_POLICY":
            # TU_09 (PdQ) -- RF.30: scarta i finding su file che non facevano parte
            # dell'ambito effettivamente passato all'LLM (allucinazioni o percorsi
            # fuori scope). "Fail open": se l'elenco non e' disponibile (chiamata
            # senza loaded_context, es. retrocompatibilita'), non filtra nulla.
            allowed_files = (loaded_context or {}).get("files_to_scan")
            if allowed_files is not None:
                allowed_files = set(allowed_files)
                blocks = [b for b in blocks if b.filePath in allowed_files]

            # TU_10 (PdQ) -- RF.61: ordina i finding dal piu' critico al meno
            # critico, cosi' che il Security Auditor veda per primi i problemi
            # piu' gravi nel report.
            blocks.sort(key=lambda b: SEVERITY_ORDER.index(b.severity), reverse=True)
            blocks = [b.model_copy(update={"order": i}) for i, b in enumerate(blocks)]

        return blocks, None