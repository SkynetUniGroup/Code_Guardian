"""Test dello scheletro condiviso.

Il grafo è testato con un profilo fittizio e FakeLLMProvider: prova che
funziona PRIMA e INDIPENDENTEMENTE dagli agenti reali.
"""

import unittest

from code_guardian.errors import ParseError
from code_guardian.graph import AgentGraph
from code_guardian.llm import FakeLLMProvider
from code_guardian.models import ContextRef, TextBlock
from code_guardian.ports import AgentProfile, ContextLoader, LoadedContext, Prompt


class StubLoader(ContextLoader):
    def __init__(self, empty=False):
        self.empty = empty

    def load(self, ref):
        if self.empty:
            return LoadedContext()
        return LoadedContext(files=(("a.py", "x = 1\n"),))


class StubProfile(AgentProfile):
    agent = "owasp"
    operation = "stub"

    def __init__(self, fail_parse=False):
        self.fail_parse = fail_parse

    def build_prompt(self, ctx):
        return Prompt(system="s", user="u")

    def parse_output(self, raw):
        if self.fail_parse:
            raise ParseError("esito non interpretabile")
        return (TextBlock(content=raw),), None


class TestAgentGraph(unittest.TestCase):
    def _graph(self, loader=None, profile=None, provider=None):
        return AgentGraph(
            loader=loader or StubLoader(),
            profile=profile or StubProfile(),
            provider=provider or FakeLLMProvider("ciao"),
        )

    def test_percorso_felice(self):
        report = self._graph().run(ContextRef())
        self.assertEqual(report.status, "completato")
        self.assertIsNone(report.error)
        self.assertEqual(report.blocks[0].content, "ciao")
        self.assertEqual(report.agent, "owasp")

    def test_ramo_timeout(self):
        provider = FakeLLMProvider(raise_timeout=True)
        report = self._graph(provider=provider).run(ContextRef())
        self.assertEqual(report.status, "fallito")
        self.assertEqual(report.error.type, "timeout")
        self.assertEqual(report.blocks, [])

    def test_ramo_parse(self):
        report = self._graph(profile=StubProfile(fail_parse=True)).run(ContextRef())
        self.assertEqual(report.status, "fallito")
        self.assertEqual(report.error.type, "parse")

    def test_ramo_contesto_mancante(self):
        report = self._graph(loader=StubLoader(empty=True)).run(ContextRef())
        self.assertEqual(report.status, "fallito")
        self.assertEqual(report.error.type, "context_missing")

    def test_il_grafo_non_solleva_mai(self):
        """Qualunque errore finisce nel Report: nessuna eccezione propagata."""

        class Exploding(ContextLoader):
            def load(self, ref):
                raise RuntimeError("boom")

        report = self._graph(loader=Exploding()).run(ContextRef())
        self.assertEqual(report.status, "fallito")

    def test_durata_valorizzata(self):
        report = self._graph().run(ContextRef())
        self.assertGreaterEqual(report.duration_ms, 0)

    def test_report_serializzabile(self):
        report = self._graph().run(ContextRef())
        self.assertIn('"agent": "owasp"', report.to_json())


if __name__ == "__main__":
    unittest.main()
