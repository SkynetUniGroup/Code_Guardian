"""Test dell'agente Docs, in isolamento."""

import json
import unittest

from code_guardian.agents import DocsInlineProfile
from code_guardian.errors import ParseError
from code_guardian.ports import LoadedContext

PY = '''def sommare(a, b):
    return a + b


def gia_documentata(x):
    """Raddoppia x."""
    return x * 2
'''

JS = """function renderComment(el, c) {
  el.innerHTML = c.body;
}

/**
 * Formatta.
 */
function formatDate(d) {
  return d.toISOString();
}
"""


class TestDocsDetection(unittest.TestCase):
    def setUp(self):
        self.p = DocsInlineProfile()

    def test_rileva_solo_python_non_documentate(self):
        units = self.p.detect_undocumented("m.py", PY)
        names = [u.name for u in units]
        self.assertEqual(names, ["sommare"])
        self.assertEqual(units[0].line, 1)

    def test_rileva_solo_js_senza_jsdoc(self):
        units = self.p.detect_undocumented("m.js", JS)
        self.assertEqual([u.name for u in units], ["renderComment"])

    def test_estensione_non_supportata_ignorata(self):
        self.assertEqual(self.p.detect_undocumented("a.txt", PY), [])

    def test_python_con_errore_di_sintassi_non_esplode(self):
        self.assertEqual(self.p.detect_undocumented("bad.py", "def ("), [])


class TestDocsParsing(unittest.TestCase):
    def setUp(self):
        self.p = DocsInlineProfile()
        self.p.build_prompt(LoadedContext(files=(("m.py", PY), ("m.js", JS))))

    def test_prompt_contiene_unita_rilevate(self):
        prompt = self.p.build_prompt(LoadedContext(files=(("m.py", PY),)))
        self.assertIn("sommare", prompt.user)
        self.assertNotIn("gia_documentata", prompt.user)

    def test_proposta_python_inserisce_docstring(self):
        raw = json.dumps({"docs": [{"file": "m.py", "unit": "sommare", "line": 1, "doc": "Somma due numeri."}]})
        blocks, proposal = self.p.parse_output(raw)
        self.assertEqual(blocks, ())
        self.assertIsNotNone(proposal)
        self.assertEqual(proposal.kind, "inline_doc")
        self.assertIsNone(proposal.pr_link) 
        diff = proposal.files[0].unified_diff
        self.assertIn('+    """Somma due numeri."""', diff)
        self.assertIn("--- a/m.py", diff)

    def test_proposta_js_inserisce_jsdoc_prima(self):
        raw = json.dumps({"docs": [{"file": "m.js", "unit": "renderComment", "line": 1, "doc": "Rende un commento."}]})
        _, proposal = self.p.parse_output(raw)
        diff = proposal.files[0].unified_diff
        self.assertIn("+/**", diff)
        self.assertIn("+ * Rende un commento.", diff)
        self.assertIn("+ */", diff)

    def test_diff_applicabile_mantiene_il_codice(self):
        raw = json.dumps({"docs": [{"file": "m.py", "unit": "sommare", "line": 1, "doc": "Somma."}]})
        _, proposal = self.p.parse_output(raw)
        # La riga della definizione non viene rimossa.
        self.assertNotIn("-def sommare(a, b):", proposal.files[0].unified_diff)

    def test_avvisi_diventano_finding(self):
        raw = json.dumps({"docs": [], "warnings": [{"file": "m.py", "unit": "x", "line": 3, "message": "troppo complessa"}]})
        blocks, proposal = self.p.parse_output(raw)
        self.assertIsNone(proposal)
        self.assertEqual(blocks[0].category, "avviso")
        self.assertEqual(blocks[0].severity, "info")

    def test_file_fuori_ambito_rifiutato(self):
        raw = json.dumps({"docs": [{"file": "altro.py", "line": 1, "doc": "x"}]})
        with self.assertRaises(ParseError):
            self.p.parse_output(raw)

    def test_risposta_senza_docs(self):
        with self.assertRaises(ParseError):
            self.p.parse_output('{"warnings": []}')


if __name__ == "__main__":
    unittest.main()
