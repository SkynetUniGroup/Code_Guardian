"""Test della modalità guidata della CLI (nessuna rete, provider `fake`)."""

import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

from code_guardian.cli import AGENT_CHOICES, PROVIDER_CHOICES, _ask_continue, _choose, _run_once, main, run_wizard
from code_guardian.config import settings


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


class TestAskContinue(unittest.TestCase):
    def test_risposte_affermative(self):
        for risposta in ("s", "S", "si", "sì", "y", "yes", "  si  "):
            self.assertTrue(_ask_continue(_scripted(risposta)), risposta)

    def test_invio_o_risposta_negativa(self):
        for risposta in ("", "n", "no", "boh"):
            self.assertFalse(_ask_continue(_scripted(risposta)), risposta)

    def test_input_esaurito_non_solleva(self):
        def _eof(_prompt=""):
            raise EOFError

        self.assertFalse(_ask_continue(_eof))


class TestRunOnce(unittest.TestCase):
    def test_chiave_anthropic_mancante_non_solleva(self):
        argv = ["owasp", "--repo", "examples/sample_repo", "--provider", "anthropic"]
        with patch("code_guardian.cli.build_provider", side_effect=RuntimeError("ANTHROPIC_API_KEY non impostata")):
            out = io.StringIO()
            with redirect_stdout(out):
                exit_code = _run_once(argv, api_key=None)
        self.assertEqual(exit_code, 1)
        self.assertIn("Configurazione mancante", out.getvalue())
        self.assertIn("ANTHROPIC_API_KEY non impostata", out.getvalue())


class TestRunOnceTimeout(unittest.TestCase):
    def _timeout_usato(self, argv):
        with patch("code_guardian.cli.build_provider"):
            with patch("code_guardian.cli.AgentGraph") as agent_graph_cls:
                fake_report = Mock(status="completato")
                fake_report.to_json.return_value = "{}"
                agent_graph_cls.return_value.run.return_value = fake_report
                with redirect_stdout(io.StringIO()):
                    _run_once(argv, api_key=None)
        return agent_graph_cls.call_args.kwargs["timeout_s"]

    def test_ollama_usa_il_default_piu_alto(self):
        argv = ["owasp", "--repo", "examples/sample_repo", "--provider", "ollama", "--format", "json"]
        self.assertEqual(self._timeout_usato(argv), settings.ollama_agent_timeout_s)

    def test_altri_provider_usano_rq7(self):
        for provider in ("anthropic", "fake"):
            argv = ["owasp", "--repo", "examples/sample_repo", "--provider", provider, "--format", "json"]
            self.assertEqual(self._timeout_usato(argv), settings.agent_timeout_s, provider)

    def test_flag_esplicito_vince_sempre(self):
        argv = [
            "owasp",
            "--repo",
            "examples/sample_repo",
            "--provider",
            "ollama",
            "--timeout",
            "10",
            "--format",
            "json",
        ]
        self.assertEqual(self._timeout_usato(argv), 10)


class TestMainModalitaGuidata(unittest.TestCase):
    def test_nessun_argomento_attiva_il_wizard(self):
        argv_sintetizzato = ["owasp", "--repo", "examples/sample_repo", "--provider", "fake"]
        out = io.StringIO()
        with patch("code_guardian.cli.run_wizard", return_value=(argv_sintetizzato, None)) as wizard:
            with patch("code_guardian.cli._ask_continue", return_value=False):
                with redirect_stdout(out):
                    main([])
        wizard.assert_called_once()
        self.assertIn("agente `owasp`", out.getvalue())

    def test_argomenti_espliciti_non_attivano_il_wizard(self):
        with patch("code_guardian.cli.run_wizard") as wizard:
            with redirect_stdout(io.StringIO()):
                main(["owasp", "--repo", "examples/sample_repo", "--provider", "fake"])
        wizard.assert_not_called()

    def test_argomenti_espliciti_non_chiedono_di_continuare(self):
        # Invocazione scriptabile: una sola esecuzione, mai il prompt del loop.
        with patch("code_guardian.cli._ask_continue") as ask_continue:
            with redirect_stdout(io.StringIO()):
                main(["owasp", "--repo", "examples/sample_repo", "--provider", "fake"])
        ask_continue.assert_not_called()

    def test_chiave_raccolta_dal_wizard_arriva_al_provider(self):
        argv_sintetizzato = ["owasp", "--repo", "examples/sample_repo", "--provider", "anthropic"]
        with patch("code_guardian.cli.run_wizard", return_value=(argv_sintetizzato, "sk-dal-wizard")):
            with patch("code_guardian.cli._ask_continue", return_value=False):
                with patch("code_guardian.cli.build_provider") as build_provider:
                    build_provider.return_value.complete.return_value = "{}"
                    with redirect_stdout(io.StringIO()):
                        main([])
        build_provider.assert_called_once_with("anthropic", api_key="sk-dal-wizard")

    def test_il_wizard_si_ripete_finche_lutente_non_si_ferma(self):
        argv1 = ["owasp", "--repo", "examples/sample_repo", "--provider", "fake"]
        argv2 = ["docs", "--repo", "examples/sample_repo", "--provider", "fake"]
        with patch("code_guardian.cli.run_wizard", side_effect=[(argv1, None), (argv2, None)]) as wizard:
            with patch("code_guardian.cli._ask_continue", side_effect=[True, False]) as ask_continue:
                with redirect_stdout(io.StringIO()):
                    main([])
        self.assertEqual(wizard.call_count, 2)
        self.assertEqual(ask_continue.call_count, 2)

    def test_una_sola_risposta_negativa_ferma_il_wizard(self):
        argv = ["owasp", "--repo", "examples/sample_repo", "--provider", "fake"]
        with patch("code_guardian.cli.run_wizard", return_value=(argv, None)) as wizard:
            with patch("code_guardian.cli._ask_continue", return_value=False):
                with redirect_stdout(io.StringIO()):
                    main([])
        wizard.assert_called_once()

    def test_chiave_mancante_torna_al_menu_invece_di_bloccare_lapp(self):
        # Riproduce lo scenario segnalato: provider anthropic senza chiave,
        # nessun traceback, e il wizard riparte per un secondo giro.
        argv_anthropic = ["owasp", "--repo", "examples/sample_repo", "--provider", "anthropic"]
        argv_fake = ["owasp", "--repo", "examples/sample_repo", "--provider", "fake"]
        provider_fake_riuscito = Mock()
        provider_fake_riuscito.complete.return_value = "{}"
        with patch(
            "code_guardian.cli.run_wizard",
            side_effect=[(argv_anthropic, None), (argv_fake, None)],
        ) as wizard:
            with patch("code_guardian.cli._ask_continue", side_effect=[True, False]):
                with patch(
                    "code_guardian.cli.build_provider",
                    side_effect=[RuntimeError("ANTHROPIC_API_KEY non impostata"), provider_fake_riuscito],
                ):
                    out = io.StringIO()
                    with redirect_stdout(out):
                        exit_code = main([])
        self.assertEqual(wizard.call_count, 2)
        self.assertIn("Configurazione mancante", out.getvalue())
        self.assertEqual(exit_code, 1)


if __name__ == "__main__":
    unittest.main()
