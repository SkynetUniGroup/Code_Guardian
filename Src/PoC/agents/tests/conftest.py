import os
from pathlib import Path

# NOTA MANUTENZIONE: 'PROMPTS_DIR' di default punta al path assoluto del
# container Docker (/app/prompts, vedi .env e agents/Dockerfile). In quel
# contesto la variabile d'ambiente reale iniettata da `env_file: .env` in
# docker-compose ha sempre precedenza su questo default. Qui usiamo
# setdefault SOLO per permettere alla suite di funzionare anche quando viene
# lanciata direttamente con `pytest` fuori dal container (dev locale, CI che
# non avvia lo stack Docker): non altera in alcun modo il comportamento a
# runtime dell'agente reale.
os.environ.setdefault("PROMPTS_DIR", str(Path(__file__).resolve().parent.parent / "prompts"))

import pytest
from typing import List, Any
from langchain_core.messages import BaseMessage, AIMessage

from src.llm import LLMProvider
from src.github_toolset import GitHubToolset

class MockLLMProvider(LLMProvider):
    """Provider simulato per eseguire test offline e a costo zero."""
    def __init__(self, response_content: str, throw_error: Exception = None):
        self.response_content = response_content
        self.throw_error = throw_error

    async def invoke_agent(self, messages: List[BaseMessage], tools: List[Any], timeout_s: int) -> BaseMessage:
        if self.throw_error:
            raise self.throw_error
        # Restituisce un finto messaggio LLM
        return AIMessage(content=self.response_content)
        
    async def complete(self, prompt: str, timeout_s: int) -> tuple[str, int]:
        if self.throw_error:
            raise self.throw_error
        return self.response_content, 42  # 42 token consumati fittizi

class MockGitHubToolset(GitHubToolset):
    """Client GitHub finto con risposte registrate per test deterministici."""
    def __init__(self):
        # Sovrascriviamo l'init per non richiedere la configurazione di rete
        self.user_id = "test_user"
        self.task_id = "test_task"

    async def read_tree(self, owner: str, repo: str, sha: str):
        return {"nodes": [{"path": "src/main.ts", "type": "file"}]}

    async def read_file(self, owner: str, repo: str, sha: str, path: str):
        return {"content": "const secret = 'password123';", "path": path}

    async def report_progress(self, stage: str, percent: int):
        pass  # allineato alla firma reale (github_toolset.py)

@pytest.fixture
def mock_github():
    return MockGitHubToolset()