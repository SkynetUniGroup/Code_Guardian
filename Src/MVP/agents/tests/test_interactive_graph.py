"""Tests for the interactive interrupts of the Changelog Agent.

Verifies the MVP flow, which involves pausing execution (interrupts)
to await human confirmations or missing data.
"""

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from conftest import MockGitHubToolset, MockLLMProvider
from src.agents.changelog import ChangelogBusinessProfile, ChangelogLoader
from src.graph import AgentGraph, AgentState


@pytest.mark.asyncio
async def test_changelog_graph_interactive_interrupts(mvp_context) -> None:
    """Verifies the Changelog Agent flow with human-in-the-loop interrupts.

    Ensures the graph correctly pauses on INCOMPLETE_TASKS and
    BUSINESS_CONFIRMATION, and successfully completes after receiving
    the appropriate resume commands.

    Args:
        mvp_context: Pytest fixture providing the context reference.
    """
    mock_provider = MockLLMProvider([
        '# Technical Changelog\n- Update DB',
        '# Business Changelog\nThe database has been updated for better performance.'
    ])
    toolset = MockGitHubToolset()
    checkpointer = MemorySaver()
    
    loader = ChangelogLoader(operation='CHANGELOG_BUSINESS')
    profile = ChangelogBusinessProfile()
    graph = AgentGraph(
        loader=loader, 
        profile=profile, 
        provider=mock_provider, 
        timeout_s=120, 
        checkpointer=checkpointer
    )
    
    initial_state = AgentState(
        user_id='user_1',
        task_id='task_1',
        context_ref=mvp_context,
        toolset=toolset,
        # Sprint ID is properly injected into the payload
        agent_payload={'sprintId': 'Sprint 1'} 
    )

    # Phase 1: Start. Execution must interrupt on INCOMPLETE_TASKS
    result_1 = await graph.execute_step(
        initial_state=initial_state, 
        thread_id='test_thread_123'
    )
    
    assert result_1['status'] == 'interrupted'
    assert result_1['pendingInput']['kind'] == 'INCOMPLETE_TASKS'

    # Phase 2: User confirms proceeding, discarding poor issues
    result_2 = await graph.execute_step(
        resume_command=Command(resume='PROCEED'), 
        thread_id='test_thread_123'
    )
    
    assert result_2['status'] == 'interrupted'
    assert result_2['pendingInput']['kind'] == 'BUSINESS_CONFIRMATION'

    # Phase 3: User confirms technical changelog, graph completes business phase
    result_3 = await graph.execute_step(
        resume_command=Command(resume='PROCEED'), 
        thread_id='test_thread_123'
    )
    
    assert result_3['status'] == 'completed'
    
    report_body = result_3['result']['report']['body']
    
    # Verify the final Markdown block
    assert report_body[-1]['markdown'] == (
        '# Business Changelog\nThe database has been updated for better performance.'
    )