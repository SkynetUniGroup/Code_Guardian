"""Tests for the security parser.

Verifies the correct extraction and parsing of OWASP vulnerabilities.
"""

import pytest

from src.agents.security import OwaspScanProfile
from src.models import FindingBlock


def test_security_parser_valid_json() -> None:
    """Verifies that the parser correctly extracts OWASP vulnerabilities."""
    # MVP: No operation parameter required, the class defines it internally
    profile = OwaspScanProfile()
    
    # Mock JSON simulating the LLM response
    raw_llm_output = '''
    ```json
    {
      "findings": [
        {
          "category": "A01:2021-Broken Access Control",
          "severity": "high",
          "file": "src/auth.ts",
          "start_line": 10,
          "end_line": 12,
          "message": "Missing token verification",
          "remediation": {"kind": "text", "markdown": "Add JWT validation."}
        }
      ]
    }
    ```
    '''
    
    blocks, proposal = profile.parse_output(raw_llm_output)
    
    assert proposal is None
    assert len(blocks) == 1
    assert isinstance(blocks[0], FindingBlock)
    
    finding = blocks[0]
    assert finding.category == 'A01:2021-Broken Access Control'
    assert finding.severity == 'HIGH'
    assert finding.remediation.kind == 'TEXT'
    assert finding.remediation.text == 'Add JWT validation.'