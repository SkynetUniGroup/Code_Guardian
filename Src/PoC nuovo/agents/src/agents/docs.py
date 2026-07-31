"""Agente Docs -- operazione DOCS_INLINE.
Trova codice non documentato, interpella l'LLM e produce una Proposal di diff.
"""
import re
from typing import Any, Tuple, List, Optional
from ..models import Proposal, Block, TextBlock
from ..github_toolset import GitHubToolset
from ._base import load_prompt_template, render_prompt, extract_json

class DocsLoader:
    """Carica il contesto iniziale da GitHub via NestJS in modo asincrono."""
    
    def _find_undocumented_units(self, content: str, filepath: str) -> list[str]:
        """Pre-analisi locale per individuare funzioni/classi non documentate (Euristica per PoC)."""
        lines = content.split('\n')
        undocumented = []
        
        if filepath.endswith('.py'):
            for i, line in enumerate(lines):
                stripped = line.strip()
                if stripped.startswith('def ') or stripped.startswith('class '):
                    has_doc = False
                    for j in range(i + 1, min(i + 4, len(lines))):
                        next_line = lines[j].strip()
                        if next_line:
                            if next_line.startswith('"""') or next_line.startswith("'''"):
                                has_doc = True
                            break
                    
                    if not has_doc:
                        match = re.search(r'(def|class)\s+([a-zA-Z0-9_]+)', line)
                        if match:
                            undocumented.append(f"Riga {i+1}: {match.group(2)}")
        else:
            for i, line in enumerate(lines):
                if re.search(r'(function\s+[a-zA-Z0-9_]+|class\s+[a-zA-Z0-9_]+|const\s+[a-zA-Z0-9_]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>)', line):
                    has_doc = False
                    for j in range(i - 1, max(i - 4, -1), -1):
                        prev_line = lines[j].strip()
                        if prev_line:
                            if prev_line.endswith('*/') or prev_line.startswith('//'):
                                has_doc = True
                            break
                            
                    if not has_doc:
                        match = re.search(r'(?:function|class|const)\s+([a-zA-Z0-9_]+)', line)
                        if match:
                            undocumented.append(f"Riga {i+1}: {match.group(1)}")
                            
        return undocumented

    async def load(self, context_ref: Any, toolset: GitHubToolset) -> dict:
        owner = context_ref.repoOwner
        repo = context_ref.repoName
        sha = context_ref.ref
        
        # 1. Chiediamo l'albero dei file
        tree_response = await toolset.read_tree(owner, repo, sha)
        nodes = tree_response.get("nodes", [])
        
        # 2. Carichiamo proattivamente package.json e README se esistono 
        package_json = "Non trovato."
        readme = "Non trovato."
        
        for n in nodes:
            if n["path"].lower() == "package.json":
                resp = await toolset.read_file(owner, repo, sha, n["path"])
                package_json = resp.get("content", "Non trovato.")
            elif n["path"].lower() == "readme.md":
                resp = await toolset.read_file(owner, repo, sha, n["path"])
                readme = resp.get("content", "Non trovato.")

        supported_exts = (".ts", ".js", ".py")
        files_to_doc = [n["path"] for n in nodes if n["type"] == "file" and n["path"].endswith(supported_exts)]
        
        # 3. PRE-ANALISI LOCALE: Rilevamento delle unità non documentate
        undocumented_summary = []
        for path in files_to_doc:
            file_resp = await toolset.read_file(owner, repo, sha, path)
            content = file_resp.get("content", "")
            if content:
                units = self._find_undocumented_units(content, path)
                if units:
                    undocumented_summary.append(f"- File: {path}")
                    for u in units:
                        undocumented_summary.append(f"    - {u}")
        
        if not undocumented_summary:
            tree_str = "Nessuna unita' di codice priva di documentazione trovata tramite l'analisi statica locale."
        else:
            tree_str = "Unita' non documentate rilevate dalla pre-analisi locale (usa read_file per ispezionare il codice e generare i commenti):\n"
            tree_str += "\n".join(undocumented_summary)
        
        # Segnaliamo l'avanzamento alla UI
        await toolset.report_progress(stage="docs_context_loaded", percent=30)
        
        return {
            "language": "Determinalo in base ai file",
            "code_units": tree_str, 
            "package_json": package_json,
            "readme": readme
        }

class DocsProfile:
    """Gestisce il prompt e il parsing dell'output per l'agente Docs."""
    agent = "docs"
    operation = "DOCS_INLINE"
    
    def __init__(self):
        self._ctx = {}

    def build_prompt(self, ctx: dict) -> str:
        self._ctx = ctx  
        template_data = load_prompt_template("docs", "inline_docs")
        
        return render_prompt(
            template_data, 
            language=ctx["language"], 
            code_units=ctx["code_units"],
            package_json=ctx.get("package_json", "Non trovato."),
            readme=ctx.get("readme", "Non trovato.")
        )

    def parse_output(self, raw: str) -> Tuple[List[Block], Optional[Proposal]]:
        data = extract_json(raw)
        blocks: List[Block] = []
        order = 0

        for w in data.get("warnings", []):
            file_path = w.get("file", "unknown")
            unit_name = w.get("unit", "unità")
            line_num = w.get("line", "?")
            message = w.get("message", "Complessità eccessiva")
            
            warning_md = (
                f"**⚠️ Avviso di complessità:** L'unità `{unit_name}` nel file `{file_path}` "
                f"(riga {line_num}) è stata saltata.\n\n*Motivo:* {message}"
            )
            
            blocks.append(
                TextBlock(
                    order=order,
                    markdown=warning_md
                )
            )
            order += 1
            
        docs_list = data.get("docs", [])
        
        if not docs_list:
            return blocks, None
            
        # 2. Raggruppiamo i document comment per file
        docs_by_file = {}
        for d in docs_list:
            f = d.get("file", "unknown_file")
            if f not in docs_by_file:
                docs_by_file[f] = []
            docs_by_file[f].append(d)

        # 3. Costruiamo un diff unificato valido per file multipli
        diff_unified = ""
        for f, items in docs_by_file.items():
            diff_unified += f"--- a/{f}\n+++ b/{f}\n"
            for item in items:
                line = item.get("line", 1)
                doc_text = item.get("doc", "")
                
                doc_lines = doc_text.splitlines()
                num_lines = len(doc_lines)
                
                diff_unified += f"@@ -{line},0 +{line},{num_lines} @@\n"
                for doc_line in doc_lines:
                    diff_unified += f"+{doc_line}\n"

        files_involved = list(docs_by_file.keys())
        target_path = files_involved[0] if len(files_involved) == 1 else "Multi-file scope"

        proposal = Proposal(
            targetPath=target_path,
            diffUnified=diff_unified,
            language="auto"
        )
        
        return blocks, proposal