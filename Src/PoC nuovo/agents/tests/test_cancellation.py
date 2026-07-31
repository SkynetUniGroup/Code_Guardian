import pytest
from unittest.mock import patch, AsyncMock
from types import SimpleNamespace
from src.graph import AgentGraph, AgentCancelled
from src.agents.security import SecurityLoader, SecurityProfile
from conftest import MockLLMProvider, MockGitHubToolset

@pytest.mark.asyncio
async def test_agent_graph_cooperative_cancellation():
    """
    Verifica che il grafo si interrompa e restituisca l'esito CANCELLED
    se il flag su Redis viene rilevato alzato (Documento Cancellazione § 4 e § 6).
    """
    mock_provider = MockLLMProvider(response_content="dummy")
    mock_toolset = MockGitHubToolset()
    fake_context = SimpleNamespace(repoOwner="owner", repoName="repo", ref="sha", scopeType="FILES")
    
    # Grafo inizializzato per Security
    graph = AgentGraph(
        loader=SecurityLoader(), 
        profile=SecurityProfile(operation="SECURITY_OWASP"), 
        provider=mock_provider
    )
    
    # Usiamo 'patch.object' per simulare l'evento in cui la chiamata a Redis 
    # trovi la chiave "1" sollevando così AgentCancelled.
    with patch.object(AgentGraph, '_check_interrupts', new_callable=AsyncMock) as mock_check:
        mock_check.side_effect = AgentCancelled(stage="carica_contesto")
        
        result = await graph.run(
            task_id="task-123", 
            user_id="user-1", 
            context_ref=fake_context, 
            toolset=mock_toolset
        )
        
        # L'esito restituito dal Grafo deve coincidere col contratto di cancellazione 
        # (un dict, non l'oggetto Envelope del Report)
        assert isinstance(result, dict)
        assert result.get("status") == "CANCELLED"
        assert result.get("stage") == "carica_contesto"
        assert "report" not in result  # Nessun report deve essere generato