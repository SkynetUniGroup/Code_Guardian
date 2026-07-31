import pytest
import os
from types import SimpleNamespace
from src.graph import AgentGraph
from src.agents.security import SecurityLoader, SecurityProfile
from src.llm import get_llm_provider
from src.github_toolset import GitHubToolset

# Simuliamo il toolset per non chiamare GitHub, ma passeremo codice reale al vero LLM
class GoldenSetGitHubToolset(GitHubToolset):
    def __init__(self, vulnerable_code: str):
        self.vulnerable_code = vulnerable_code
        self.user_id = "test"
        self.task_id = "test"

    async def read_tree(self, owner: str, repo: str, sha: str):
        return {"nodes": [{"path": "vulnerable_auth.js", "type": "file"}]}

    async def read_file(self, owner: str, repo: str, sha: str, path: str):
        return {"content": self.vulnerable_code, "path": path}

    async def report_progress(self, task_id: str, stage: str, percent: int):
        pass

@pytest.mark.asyncio
# Salta il test se non c'è una chiave API configurata
@pytest.mark.skipif(not os.environ.get("LLM_API_KEY"), reason="Richiede il vero LLMProvider per misurare l'accuratezza.")
async def test_security_golden_set_accuracy():
    """
    Verifica l'accuratezza (RQ.5) sul fornitore LLM scelto (Documento Specifiche § 12).
    Si attende che il modello identifichi una vulnerabilità OWASP nota (SQL Injection).
    """
    # Golden Set: File JavaScript con una chiara SQL Injection
    vulnerable_file = """
    function login(req, res) {
        const username = req.body.username;
        const password = req.body.password;
        // Vulnerabilità: Concatenazione diretta di input utente in SQL
        const query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
        db.execute(query);
    }
    """
    
    toolset = GoldenSetGitHubToolset(vulnerable_file)
    provider = get_llm_provider() # Inizializza il vero provider (es. Qwen via DashScope)
    
    graph = AgentGraph(
        loader=SecurityLoader(), 
        profile=SecurityProfile(operation="SECURITY_OWASP"), 
        provider=provider
    )
    
    fake_context = SimpleNamespace(repoOwner="test", repoName="test", ref="main", scopeType="FILES")
    
    # Esegue la scansione reale
    report = await graph.run("task-golden", "user-golden", fake_context, toolset)
    
    assert report.status == "COMPLETED"
    
    # Calcolo accuratezza: Il modello deve aver trovato almeno 1 finding
    assert len(report.body) > 0, "L'accuratezza è 0%: il modello non ha trovato la SQL Injection."
    
    # Controlliamo che il finding rilevato sia classificato correttamente come SQL Injection o Injection
    found_injection = any("injection" in finding.owaspCategory.lower() or "injection" in finding.explanation.lower() for finding in report.body)
    assert found_injection is True, "Il modello ha trovato problemi, ma non ha identificato correttamente la SQL Injection."