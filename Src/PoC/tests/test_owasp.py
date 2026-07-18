"""Test dell'agente OWASP, in isolamento (senza rete, senza modello reale)."""

import json
import unittest

from code_guardian.agents import OwaspScanProfile
from code_guardian.errors import ParseError
from code_guardian.ports import LoadedContext

CTX = LoadedContext(files=(("src/auth.py", "a\nb\nc\nd\ne\n"),))


def _resp(**over):
    finding = {
        "category": "SQL Injection",
        "severity": "high",
        "file": "src/auth.py",
        "start_line": 2,
        "end_line": 3,
        "message": "Concatenazione di stringhe nella query.",
        "remediation": {"kind": "snippet", "language": "python", "code": "cur.execute(q, (u,))"},
    }
    finding.update(over)
    return json.dumps({"findings": [finding]})


class TestOwaspProfile(unittest.TestCase):
    def setUp(self):
        self.p = OwaspScanProfile()
        self.p.build_prompt(CTX)

    def test_prompt_da_file_esterno(self):
        prompt = self.p.build_prompt(CTX)
        self.assertIn("OWASP", prompt.system)
        self.assertIn("src/auth.py", prompt.user)
        # Le righe sono numerate: il modello può citarle.
        self.assertIn("   1 |", prompt.user)

    def test_policy_as_code_iniettata(self):
        ctx = LoadedContext(files=CTX.files, extra={"claude_md": "REGOLA-1: niente MD5"})
        prompt = self.p.build_prompt(ctx)
        self.assertIn("REGOLA-1", prompt.user)

    def test_parsing_riscontro_valido(self):
        blocks, proposal = self.p.parse_output(_resp())
        self.assertIsNone(proposal)
        self.assertEqual(len(blocks), 1)
        f = blocks[0]
        self.assertEqual(f.severity, "high")
        self.assertEqual(f.location.file, "src/auth.py")
        self.assertEqual(f.remediation.kind, "snippet")

    def test_normalizzazione_gravita(self):
        blocks, _ = self.p.parse_output(_resp(severity="MAJOR"))
        self.assertEqual(blocks[0].severity, "high")

    def test_gravita_sconosciuta_e_errore(self):
        with self.assertRaises(ParseError):
            self.p.parse_output(_resp(severity="apocalittica"))

    def test_righe_oltre_fine_file_troncate(self):
        blocks, _ = self.p.parse_output(_resp(start_line=99, end_line=120))
        self.assertEqual(blocks[0].location.start_line, 5)
        self.assertEqual(blocks[0].location.end_line, 5)

    def test_file_fuori_ambito_rifiutato(self):
        with self.assertRaises(ParseError):
            self.p.parse_output(_resp(file="/etc/passwd"))

    def test_json_dentro_recinto_markdown(self):
        blocks, _ = self.p.parse_output("```json\n" + _resp() + "\n```")
        self.assertEqual(len(blocks), 1)

    def test_risposta_malformata(self):
        for bad in ("", "non è json", "{}", '{"findings": "no"}'):
            with self.assertRaises(ParseError):
                self.p.parse_output(bad)

    def test_nessun_riscontro(self):
        blocks, _ = self.p.parse_output('{"findings": []}')
        self.assertEqual(blocks, ())

    def test_ordinamento_per_gravita(self):
        raw = json.dumps(
            {
                "findings": [
                    {"category": "A", "severity": "low", "file": "src/auth.py", "start_line": 1, "message": "m"},
                    {"category": "B", "severity": "critical", "file": "src/auth.py", "start_line": 1, "message": "m"},
                ]
            }
        )
        blocks, _ = self.p.parse_output(raw)
        self.assertEqual(blocks[0].severity, "critical")


if __name__ == "__main__":
    unittest.main()
