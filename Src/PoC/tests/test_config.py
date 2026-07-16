"""Test di `Settings` (pydantic-settings), in isolamento dal `.env` reale.

Le variabili di `Settings` (LLM_PROVIDER, ANTHROPIC_API_KEY, ...) possono
essere gia' valorizzate nella shell di chi esegue i test (il README stesso
invita a esportarle). Per questo ogni test azzera l'ambiente con
`patch.dict(..., clear=True)` invece di limitarsi a impostare la variabile che
gli interessa: altrimenti il risultato dipenderebbe da chi lancia `make test`.
"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from code_guardian.config import Settings


class TestSettings(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

    def test_variabile_ambiente_precede_sul_dotenv(self):
        """RQ: `os.environ` ha precedenza sul `.env` (default di pydantic-settings)."""
        env_file = Path(self._tmp.name) / ".env"
        env_file.write_text("LLM_PROVIDER=ollama\n")

        with patch.dict("os.environ", {"LLM_PROVIDER": "fake"}, clear=True):
            settings = Settings(_env_file=env_file)

        self.assertEqual(settings.llm_provider, "fake")

    def test_dotenv_assente_non_solleva(self):
        """Il caso normale in CI e nei test: nessun `.env`, si usano i default."""
        env_file = Path(self._tmp.name) / "non-esiste.env"
        self.assertFalse(env_file.exists())

        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=env_file)

        self.assertEqual(settings.llm_provider, "anthropic")
        self.assertIsNone(settings.anthropic_api_key)


if __name__ == "__main__":
    unittest.main()
