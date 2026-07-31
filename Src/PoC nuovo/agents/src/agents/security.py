"""Agente Security -- operazione SECURITY_OWASP.
Analizza il codice sorgente alla ricerca di vulnerabilità della OWASP Top 10.
"""

from typing import Any, Tuple, List, Optional
from ..models import Proposal, FindingBlock, Block, PolicyViolationBlock
from ..github_toolset import GitHubToolset
from ._base import load_prompt_template, render_prompt, extract_json

class SecurityLoader:
    """Carica il contesto (codice e policy) via Facade."""
    
    async def load(self, context_ref: Any, toolset: GitHubToolset) -> dict:
        owner = context_ref.repoOwner
        repo = context_ref.repoName
        sha = context_ref.ref
        
        # 1. Recuperiamo l'albero per far vedere all'LLM cosa c'è nel repository
        tree_response = await toolset.read_tree(owner, repo, sha)
        nodes = tree_response.get("nodes", [])
        
        # 2. Invece di scaricare i file, passiamo all'LLM solo i percorsi.
        supported_exts = (".ts", ".js", ".py")
        files_to_scan = [n["path"] for n in nodes if n["type"] == "file" and n["path"].endswith(supported_exts)]
        
        if not files_to_scan:
            raise ValueError("Nessun file sorgente trovato per la scansione di sicurezza.")
            
        tree_str = "File supportati disponibili nel repository (usa il tool read_file per ispezionarli):\n"
        tree_str += "\n".join(f"- {f}" for f in files_to_scan)

        # 3. Leggiamo POLICY.md se esiste, come richiesto dalle specifiche
        policy_node = next((n for n in nodes if n["path"].lower() == "policy.md"), None)
        policy_content = "Nessuna policy specifica fornita. Applica regole OWASP standard."
        if policy_node:
            p_resp = await toolset.read_file(owner, repo, sha, policy_node["path"])
            policy_content = p_resp.get("content", policy_content)
        
        # Avanzamento
        await toolset.report_progress(stage="security_context_loaded", percent=30)
        
        return {
            "policy": policy_content,
            # Passiamo l'albero invece del contenuto concatenato
            "files": tree_str
        }

class SecurityProfile:
    """Gestisce il prompt e il parsing dell'output per l'agente Security."""
    agent = "security"
    
    def __init__(self, operation: str = "SECURITY_OWASP"):
        self.operation = operation
        self._ctx = {}

    def build_prompt(self, ctx: dict) -> str:
        template_id = "owasp_scan" if self.operation == "SECURITY_OWASP" else "policy_scan"
        template_data = load_prompt_template("security", template_id)
        
        return render_prompt(
            template_data, 
            policy=ctx["policy"], 
            files=ctx["files"]
        )

    def parse_output(self, raw: str) -> Tuple[List[Block], Optional[Proposal]]:
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
            
        return blocks, None