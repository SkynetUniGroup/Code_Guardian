import pytest
from src.agents.security import SecurityProfile
from src.models import FindingBlock

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