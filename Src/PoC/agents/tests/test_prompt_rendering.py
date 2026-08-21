import pytest
from src.agents._base import render_prompt

def test_render_prompt_splits_system_and_user():
    """Verifica che il template YAML venga diviso correttamente in tupla."""
    
    mock_template = {
        "required_vars": ["var1"],
        "system_prompt": "Sei un bot di test. Regola: {var1}",
        "user_prompt": "Fai questo: {var1}",
        "output_contract": "Rispondi in JSON."
    }
    
    system_out, user_out = render_prompt(mock_template, var1="Valore1")
    
    # 1. Verifica iniezione variabili in entrambi
    assert "Regola: Valore1" in system_out
    assert "Fai questo: Valore1" in user_out
    
    # 2. Verifica che il contratto di output sia SOLO nel system prompt
    assert "[REGOLE DI OUTPUT]" in system_out
    assert "Rispondi in JSON." in system_out
    assert "[REGOLE DI OUTPUT]" not in user_out

def test_render_prompt_retrocompatibility():
    """Verifica la retrocompatibilità per template vecchi (che usavano 'body')."""
    
    mock_old_template = {
        "required_vars": ["var1"],
        "body": "Testo unico con {var1}.",
        "output_contract": "JSON."
    }
    
    system_out, user_out = render_prompt(mock_old_template, var1="Valore1")
    
    assert "Testo unico con Valore1." in system_out
    assert "JSON." in system_out
    assert user_out == "Procedi con l'elaborazione."