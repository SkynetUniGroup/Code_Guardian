"""Test di unita' per src/agents/_base.py: caricamento dei template YAML
(Appendice D) ed estrazione robusta del JSON prodotto dall'LLM.

Nessuna chiamata di rete o a un vero LLM e' coinvolta: 'load_prompt_template'
legge solo dal filesystem locale (cartella 'prompts/', gia' presente nel
repository) ed 'extract_json' e' pura logica di parsing stringa -> dict.
"""

import pytest

from src.agents._base import load_prompt_template, render_prompt, extract_json


class TestLoadPromptTemplate:
    """Copertura di load_prompt_template: percorso valido e file mancante."""

    def test_load_prompt_template_existing_file_returns_parsed_yaml(self):
        # Il file prompts/security/owasp_scan.1.0.yaml e' incluso nel repository.
        template = load_prompt_template("security", "owasp_scan")

        assert template["id"] == "owasp_scan"
        assert "policy" in template["required_vars"]
        assert "files" in template["required_vars"]
        assert "system_prompt" in template
        assert "user_prompt" in template
        assert "output_contract" in template

    def test_load_prompt_template_missing_file_raises_file_not_found_error(self):
        # Nessun agente 'inesistente' ne' template 'non_esiste' sono presenti su disco.
        with pytest.raises(FileNotFoundError):
            load_prompt_template("inesistente", "non_esiste")


class TestExtractJson:
    """Copertura delle tre strategie di estrazione JSON in extract_json."""

    def test_extract_json_parses_clean_json_directly(self):
        raw = '{"findings": []}'
        result = extract_json(raw)
        assert result == {"findings": []}

    def test_extract_json_strips_markdown_fences_and_prose(self):
        # Output tipico di un LLM: testo introduttivo + blocco ```json``` + testo finale.
        raw = (
            "Ecco il risultato della scansione:\n"
            "```json\n"
            '{"findings": [{"category": "A01", "severity": "high"}]}\n'
            "```\n"
            "Fine dell'analisi."
        )
        result = extract_json(raw)
        assert result["findings"][0]["category"] == "A01"

    def test_extract_json_fallback_escapes_raw_newlines_inside_strings(self):
        # Newline letterale (non escapato) dentro una stringa JSON: il primo
        # json.loads fallisce per carattere di controllo non valido, il
        # fallback lo ripara sostituendo '\n' con la sequenza di escape.
        raw = '{"message": "riga1\nriga2"}'
        result = extract_json(raw)
        assert "message" in result

    def test_extract_json_unparsable_content_raises_value_error(self):
        raw = "Questa non e' assolutamente una risposta JSON."
        with pytest.raises(ValueError, match="Impossibile interpretare"):
            extract_json(raw)


class TestRenderPromptEdgeCases:
    """Completa la copertura di render_prompt (i casi 'happy path' sono gia'
    coperti da test_prompt_rendering.py): qui verifichiamo la validazione
    delle variabili obbligatorie mancanti."""

    def test_render_prompt_missing_required_var_raises_value_error(self):
        template = {
            "required_vars": ["policy", "files"],
            "system_prompt": "Regola: {policy}",
            "user_prompt": "File: {files}",
        }

        with pytest.raises(ValueError, match="files"):
            render_prompt(template, policy="solo questa")
