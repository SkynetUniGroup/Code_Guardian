"""Tests for prompt rendering logic.

Verifies the separation of system and user prompts, variable injection,
and backwards compatibility with older template formats.
"""

import pytest

from src.agents._base import render_prompt


def test_render_prompt_splits_system_and_user() -> None:
    """Verifies that the YAML template is correctly split into a tuple."""
    mock_template = {
        'required_vars': ['var1'],
        'system_prompt': 'You are a test bot. Rule: {var1}',
        'user_prompt': 'Do this: {var1}',
        'output_contract': 'Reply in JSON.'
    }
    
    system_out, user_out = render_prompt(mock_template, var1='Value1')
    
    # Verify variable injection in both prompts
    assert 'Rule: Value1' in system_out
    assert 'Do this: Value1' in user_out
    
    # Verify that the output contract is ONLY in the system prompt
    assert '[OUTPUT RULES]' in system_out
    assert 'Reply in JSON.' in system_out
    assert '[OUTPUT RULES]' not in user_out


def test_render_prompt_retrocompatibility() -> None:
    """Verifies backwards compatibility for old templates (using 'body')."""
    mock_old_template = {
        'required_vars': ['var1'],
        'body': 'Single text with {var1}.',
        'output_contract': 'JSON.'
    }
    
    system_out, user_out = render_prompt(mock_old_template, var1='Value1')
    
    assert 'Single text with Value1.' in system_out
    assert 'JSON.' in system_out
    assert user_out == 'Proceed with the processing.'