import pytest
import ast
import glob
import os

def test_prompt_isolation_mpd_14():
    """
    Test statico per la metrica MPD_14 (Isolamento dei prompt).
    Analizza l'Abstract Syntax Tree (AST) dei moduli Python degli agenti.
    Fallisce se trova literal di stringa superiori alla soglia, a garanzia 
    che i prompt risiedano nei file YAML esterni (Documento Specifiche § 12).
    """
    # Soglia massima di caratteri per una stringa nel codice (tolleranza per istruzioni brevi/docstring)
    MAX_STRING_LENGTH = 250 
    
    # Recupera tutti i file .py nella cartella src/agents
    agent_files = glob.glob("src/agents/*.py")
    assert len(agent_files) > 0, "Nessun file agente trovato per l'analisi statica."
    
    for file_path in agent_files:
        with open(file_path, "r", encoding="utf-8") as f:
            code = f.read()
            
        tree = ast.parse(code, filename=file_path)
        
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                text = node.value.strip()
                
                # Escludiamo dal conteggio le docstring generiche del modulo 
                if text.startswith("Agente ") or text.startswith("Funzioni di base"):
                    continue

                if len(text) > MAX_STRING_LENGTH:
                    pytest.fail(
                        f"Violazione Metrica MPD_14 in '{os.path.basename(file_path)}' alla riga {node.lineno}.\n"
                        f"Trovata stringa hardcoded di {len(text)} caratteri.\n"
                        f"I prompt LLM devono essere isolati nei file YAML.\n"
                        f"Anteprima: {text[:50]}..."
                    )