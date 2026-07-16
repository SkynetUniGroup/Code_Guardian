"""Test della modalità guidata della CLI (nessuna rete, provider `fake`)."""

import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

from code_guardian.cli import AGENT_CHOICES, PROVIDER_CHOICES, _choose, main, run_wizard


def _scripted(*responses):
    """input_fn/secret_fn che restituisce le risposte fornite, una per chiamata."""
    it = iter(responses)
    return lambda _prompt="": next(it)


def _mai_chiamato(_prompt=""):
    raise AssertionError("non doveva essere chiamato per questo provider")


class TestChoose(unittest.TestCase):
    def test_invio_sceglie_la_prima_opzione(self):
        with redirect_stdout(io.StringIO()):
            scelta = _choose("Domanda?", AGENT_CHOICES, _scripted(""))
        self.assertEqual(scelta, AGENT_CHOICES[0][0])

    def test_numero_valido_sceglie_quella_opzione(self):
        with redirect_stdout(io.StringIO()):
            scelta = _choose("Domanda?", PROVIDER_CHOICES, _scripted("2"))
        self.assertEqual(scelta, PROVIDER_CHOICES[1][0])

    def test_input_non_valido_richiede_di_nuovo(self):
        with redirect_stdout(io.StringIO()):
            scelta = _choose("Domanda?", AGENT_CHOICES, _scripted("boh", "99", "1"))
        self.assertEqual(scelta, AGENT_CHOICES[0][0])


class TestRunWizard(unittest.TestCase):
    def test_owasp_produce_gli_argomenti_attesi(self):
        # agente=owasp (Invio), provider=fake (3), repo=Invio (default).
        # Il provider non e' anthropic: non deve mai chiedere una chiave.
        with redirect_stdout(io.StringIO()):
            argv, api_key = run_wizard(_scripted("", "3", ""), secret_fn=_mai_chiamato)
        self.assertEqual(argv, ["owasp", "--provider", "fake", "--repo", "examples/sample_repo"])
        self.assertIsNone(api_key)

    def test_changelog_con_sprint_produce_gli_argomenti_attesi(self):
        # agente=changelog (3), provider=anthropic (Invio), chiave=Invio,
        # tasks=Invio, sprint=S-12.
        with redirect_stdout(io.StringIO()):
            argv, api_key = run_wizard(_scripted("3", "", "", "S-12"), secret_fn=_scripted(""))
        self.assertEqual(
            argv,
            [
                "changelog",
                "--provider",
                "anthropic",
                "--tasks",
                "examples/sprint_tasks.json",
                "--sprint",
                "S-12",
            ],
        )
        self.assertIsNone(api_key)

    def test_changelog_senza_sprint_omette_il_flag(self):
        with redirect_stdout(io.StringIO()):
            argv, _ = run_wizard(_scripted("3", "", "", ""), secret_fn=_scripted(""))
        self.assertNotIn("--sprint", argv)

    def test_anthropic_chiede_la_chiave_e_non_la_mette_negli_argomenti(self):
        secret_fn = Mock(return_value="sk-test-123")
        with redirect_stdout(io.StringIO()):
            argv, api_key = run_wizard(_scripted("", "", ""), secret_fn=secret_fn)
        secret_fn.assert_called_once()
        self.assertEqual(api_key, "sk-test-123")
        self.assertNotIn("sk-test-123", argv)

    def test_provider_diverso_da_anthropic_non_chiede_mai_la_chiave(self):
        secret_fn = Mock()
        with redirect_stdout(io.StringIO()):
            run_wizard(_scripted("", "2", ""), secret_fn=secret_fn)  # provider=ollama
        secret_fn.assert_not_called()


class TestMainModalitaGuidata(unittest.TestCase):
    def test_nessun_argomento_attiva_il_wizard(self):
        argv_sintetizzato = ["owasp", "--repo", "examples/sample_repo", "--provider", "fake"]
        out = io.StringIO()
        with patch("code_guardian.cli.run_wizard", return_value=(argv_sintetizzato, None)) as wizard:
            with redirect_stdout(out):
                main([])
        wizard.assert_called_once()
        self.assertIn("agente `owasp`", out.getvalue())

    def test_argomenti_espliciti_non_attivano_il_wizard(self):
        with patch("code_guardian.cli.run_wizard") as wizard:
            with redirect_stdout(io.StringIO()):
                main(["owasp", "--repo", "examples/sample_repo", "--provider", "fake"])
        wizard.assert_not_called()

    def test_chiave_raccolta_dal_wizard_arriva_al_provider(self):
        argv_sintetizzato = ["owasp", "--repo", "examples/sample_repo", "--provider", "anthropic"]
        with patch("code_guardian.cli.run_wizard", return_value=(argv_sintetizzato, "sk-dal-wizard")):
            with patch("code_guardian.cli.build_provider") as build_provider:
                build_provider.return_value.complete.return_value = "{}"
                with redirect_stdout(io.StringIO()):
                    main([])
        build_provider.assert_called_once_with("anthropic", api_key="sk-dal-wizard")


if __name__ == "__main__":
    unittest.main()
