import pytest
from src.agents.security import SecurityProfile
from src.models import FindingBlock


def _raw_with_findings(*findings: dict) -> str:
    import json
    return "```json\n" + json.dumps({"findings": list(findings)}) + "\n```"

def test_security_parser_valid_json():
    """Verifica che il parser estragga correttamente le vulnerabilità OWASP."""
    profile = SecurityProfile(operation="SECURITY_OWASP")
    
    # JSON fittizio che simula la risposta dell'LLM
    raw_llm_output = """
    ```json
    {
      "findings": [
        {
          "category": "A01:2021-Broken Access Control",
          "severity": "high",
          "file": "src/auth.ts",
          "start_line": 10,
          "end_line": 12,
          "message": "Mancanza di verifica del token",
          "remediation": {"kind": "text", "markdown": "Aggiungere validazione JWT."}
        }
      ]
    }
    ```
    """
    
    blocks, proposal = profile.parse_output(raw_llm_output)
    
    assert proposal is None
    assert len(blocks) == 1
    assert isinstance(blocks[0], FindingBlock)
    
    finding = blocks[0]
    assert finding.owaspCategory == "A01:2021-Broken Access Control"
    assert finding.severity == "high"
    assert finding.filePath == "src/auth.ts"
    assert finding.remediation == "Aggiungere validazione JWT."


def test_security_parser_orders_findings_by_severity_descending():
    """TU_10 (PdQ) -- RF.61: i finding OWASP vengono riordinati dal più critico
    al meno critico, indipendentemente dall'ordine restituito dall'LLM, e il
    campo 'order' viene riassegnato coerentemente con il nuovo ordinamento."""
    profile = SecurityProfile(operation="SECURITY_OWASP")

    raw = _raw_with_findings(
        {"category": "A05", "severity": "low", "file": "a.ts", "start_line": 1, "end_line": 1, "message": "m1"},
        {"category": "A03", "severity": "critical", "file": "b.ts", "start_line": 2, "end_line": 2, "message": "m2"},
        {"category": "A02", "severity": "medium", "file": "c.ts", "start_line": 3, "end_line": 3, "message": "m3"},
        {"category": "A01", "severity": "high", "file": "d.ts", "start_line": 4, "end_line": 4, "message": "m4"},
    )

    blocks, _ = profile.parse_output(raw)

    assert [b.severity for b in blocks] == ["critical", "high", "medium", "low"]
    assert [b.order for b in blocks] == [0, 1, 2, 3]
    # Il riordino non deve scambiare i dati associati a ciascun finding.
    assert blocks[0].filePath == "b.ts"
    assert blocks[-1].filePath == "a.ts"


def test_security_parser_discards_findings_outside_the_requested_scope():
    """TU_09 (PdQ) -- RF.30: un finding su un file che non era nell'elenco
    'files_to_scan' passato dal loader viene scartato (allucinazione o file
    fuori ambito), senza far fallire il parsing degli altri finding validi."""
    profile = SecurityProfile(operation="SECURITY_OWASP")

    raw = _raw_with_findings(
        {"category": "A03", "severity": "high", "file": "src/auth.ts", "start_line": 1, "end_line": 1, "message": "in scope"},
        {"category": "A03", "severity": "critical", "file": "src/non-richiesto.ts", "start_line": 1, "end_line": 1, "message": "allucinato"},
    )

    loaded_context = {"files_to_scan": ["src/auth.ts", "src/other.ts"]}
    blocks, _ = profile.parse_output(raw, loaded_context)

    assert len(blocks) == 1
    assert blocks[0].filePath == "src/auth.ts"


def test_security_parser_does_not_filter_when_loaded_context_has_no_scope_info():
    """Comportamento 'fail open': senza un loaded_context (es. retrocompatibilità
    con chiamate dirette a parse_output(raw)), nessun finding viene scartato."""
    profile = SecurityProfile(operation="SECURITY_OWASP")

    raw = _raw_with_findings(
        {"category": "A03", "severity": "high", "file": "qualsiasi/percorso.ts", "start_line": 1, "end_line": 1, "message": "m"},
    )

    blocks, _ = profile.parse_output(raw)

    assert len(blocks) == 1