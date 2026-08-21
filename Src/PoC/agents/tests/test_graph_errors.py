import pytest
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock
from src.graph import AgentGraph, AgentState
from src.models import Report
from src.agents.security import SecurityLoader, SecurityProfile
from conftest import MockLLMProvider, MockGitHubToolset

@pytest.mark.asyncio
async def test_graph_handles_parsing_error_gracefully():
    """
    Verifica che un errore di parsing (es. JSON malformato dall'LLM)
    non provochi crash ma venga convertito in un Report FAILED (Contratto Report).
    """
    # 1. Setup mock con JSON rotto
    bad_json_response = "Questo non è un JSON valido { { { rotti"
    mock_provider = MockLLMProvider(response_content=bad_json_response)
    mock_toolset = MockGitHubToolset()
    
    # Contesto fittizio
    fake_context = SimpleNamespace(
        repoOwner="owner", 
        repoName="repo", 
        ref="sha123", 
        scopeType="FULL_REPOSITORY"
    )
    
    # 2. Inizializza il Grafo
    graph = AgentGraph(
        loader=SecurityLoader(), 
        profile=SecurityProfile(operation="SECURITY_OWASP"), 
        provider=mock_provider
    )
    
    # 3. Esegui la run
    with patch.object(AgentGraph, '_check_interrupts', new_callable=AsyncMock):
        report = await graph.run(
            task_id="task-123", user_id="user-1",
            context_ref=fake_context, toolset=mock_toolset
        )
    
    # 4. Assert: Deve essere un Report (non un'eccezione non gestita)
    assert isinstance(report, Report)
    # Lo stato deve essere FAILED
    assert report.status == "FAILED"
    # Il campo errore deve essere popolato e di tipo PARSING
    assert report.error is not None
    assert report.error.kind == "PARSING"