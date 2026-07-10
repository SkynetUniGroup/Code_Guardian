"""Test dell'agente Changelog, in isolamento."""

import unittest

from code_guardian.agents import ChangelogTechProfile
from code_guardian.errors import ContextMissing, ParseError
from code_guardian.ports import LoadedContext

BUONO = {
    "id": "CG-1",
    "title": "Token a scadenza",
    "status": "done",
    "description": "Introdotto il rilascio di token JWT con scadenza a quindici minuti.",
    "acceptance_criteria": ["scade dopo 15 minuti"],
    "url": "https://example.org/1",
}
POVERO = {"id": "CG-2", "title": "Fix", "status": "done", "description": "fix", "acceptance_criteria": []}
SENZA_CRITERI = {
    "id": "CG-3",
    "title": "Refactor logging",
    "status": "done",
    "description": "Sostituito il logger interno con la libreria standard, uniformando i livelli.",
    "acceptance_criteria": [],
}
IN_CORSO = dict(BUONO, id="CG-4", status="in_progress")


def _ctx(tasks, sprint="S-1"):
    return LoadedContext(payload=tasks, extra={"sprint_id": sprint})


class TestQualityGate(unittest.TestCase):
    def test_scarta_descrizione_povera(self):
        kept, excl = ChangelogTechProfile.quality_gate([BUONO, POVERO])
        self.assertEqual([t["id"] for t in kept], ["CG-1"])
        self.assertEqual(excl[0].task_id, "CG-2")
        self.assertIn("povera", excl[0].reason)

    def test_scarta_senza_criteri_accettazione(self):
        kept, excl = ChangelogTechProfile.quality_gate([SENZA_CRITERI])
        self.assertEqual(kept, [])
        self.assertIn("criteri", excl[0].reason)

    def test_tiene_i_validi(self):
        kept, excl = ChangelogTechProfile.quality_gate([BUONO])
        self.assertEqual(len(kept), 1)
        self.assertEqual(excl, [])


class TestChangelogProfile(unittest.TestCase):
    def setUp(self):
        self.p = ChangelogTechProfile()

    def test_filtra_i_non_completati(self):
        prompt = self.p.build_prompt(_ctx([BUONO, IN_CORSO]))
        self.assertIn("CG-1", prompt.user)
        self.assertNotIn("CG-4", prompt.user)

    def test_sprint_nel_prompt(self):
        prompt = self.p.build_prompt(_ctx([BUONO], sprint="S-12"))
        self.assertIn("S-12", prompt.user)

    def test_nessuna_storia_valida_e_contesto_mancante(self):
        with self.assertRaises(ContextMissing):
            self.p.build_prompt(_ctx([POVERO]))

    def test_esito_testuale_con_avvisi_per_gli_scarti(self):
        self.p.build_prompt(_ctx([BUONO, POVERO]))
        blocks, proposal = self.p.parse_output("# Changelog\n\n## Funzionalità\n- Token a scadenza.")
        self.assertIsNone(proposal)  # nessuna proposta di diff
        self.assertEqual(blocks[0].kind, "text")
        avvisi = [b for b in blocks if getattr(b, "category", None) == "avviso"]
        self.assertEqual(len(avvisi), 1)
        self.assertIn("CG-2", avvisi[0].location.file)

    def test_arricchimento_con_link_ai_ticket(self):
        self.p.build_prompt(_ctx([BUONO]))
        blocks, _ = self.p.parse_output("# Changelog\n\n- Token a scadenza implementati.")
        self.assertIn("https://example.org/1", blocks[0].content)
        self.assertIn("## Storie incluse", blocks[0].content)

    def test_changelog_vuoto_o_troppo_breve(self):
        self.p.build_prompt(_ctx([BUONO]))
        for bad in ("", "   ", "ok"):
            with self.assertRaises(ParseError):
                self.p.parse_output(bad)


if __name__ == "__main__":
    unittest.main()
