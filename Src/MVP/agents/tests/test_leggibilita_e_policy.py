"""Test dei quattro difetti trovati facendo girare gli agenti a mano.

Nessuno di questi test invoca un modello: quello che va verificato qui e' la
parte che scriviamo noi — il contratto di ritorno del parsing della Policy e
la misura di leggibilita' del Changelog di business. Cosa scriva davvero il
modello e' affare del modello; che il nostro codice sappia misurarlo e
restituirlo, no.

Ogni test e' costruito per tornare rosso se la correzione viene disfatta:
sono le quattro condizioni che in produzione hanno fatto fallire operazioni
intere, non esempi di comodo.
"""

from __future__ import annotations

from src.agents.changelog import ChangelogBusinessProfile, calculate_flesch_reading_ease
from src.agents.security import SecurityPolicyProfile
from src.models import PolicyViolationBlock

SOGLIA = 50.0

# Un changelog di business scritto come si deve: frasi corte, parole corte,
# e i collegamenti alle issue conservati parola per parola come impone il
# prompt. Deve superare la soglia.
CHANGELOG_PIANO = """# Release Notes - Sprint 2

## New Features
- You can now search your saved reports. ([#10](https://github.com/org/repo/issues/10))
- Failed requests are tried again. ([#11](https://github.com/org/repo/issues/11))

## Bug Fixes
- The monthly limit reset on the wrong day. This is now fixed. \
([#12](https://github.com/org/repo/issues/12))
"""

# Lo stesso contenuto, ma nel registro aziendale che il modello produce da
# solo se nessuno gli dice di smettere. Deve restare sotto la soglia: se
# passasse anche questo, il controllo non controllerebbe piu' niente.
CHANGELOG_GONFIO = """# Release Notes - Sprint 2

## New Features
- Enhanced system traceability and audit capabilities for suspended operations, providing \
better oversight and compliance support ([#13](https://github.com/org/repo/issues/13))
- Enabled powerful full-text search functionality for archived reports, substantially \
improving the discoverability of historical information ([#10](https://github.com/org/repo/issues/10))
"""


class TestLeggibilita:
    """La misura di leggibilita' del Changelog di business."""

    def test_i_collegamenti_non_affossano_il_punteggio(self) -> None:
        """Il prompt impone di conservare i link: misurarli e' punire l'obbedienza.

        Un URL contava come una parola sola da una quindicina di gruppi
        vocalici, e tre bastavano a portare sotto zero un testo che senza di
        essi passava con largo margine.
        """
        con_link = CHANGELOG_PIANO
        senza_link = (
            "# Release Notes - Sprint 2\n\n"
            "## New Features\n"
            "- You can now search your saved reports.\n"
            "- Failed requests are tried again.\n\n"
            "## Bug Fixes\n"
            "- The monthly limit reset on the wrong day. This is now fixed.\n"
        )

        scarto = abs(calculate_flesch_reading_ease(con_link) - calculate_flesch_reading_ease(senza_link))
        assert scarto < 15.0, (
            "i collegamenti spostano il punteggio di piu' di quindici punti: "
            "vengono ancora contati come prosa"
        )

    def test_un_elenco_puntato_non_e_una_frase_sola(self) -> None:
        """Le voci di un elenco non finiscono col punto, ma restano frasi.

        Contando solo la punteggiatura forte, un changelog intero risultava
        un'unica frase da decine di parole, e il termine parole-per-frase da
        solo valeva quaranta punti di penalita'.
        """
        # L'elenco dev'essere lungo quanto un changelog vero: con tre voci
        # brevi la penalita' di "una frase sola" non basta ad affondare il
        # punteggio, e il test resterebbe verde anche col difetto rimesso.
        senza_punti = (
            "# Release Notes - Sprint 2\n\n"
            "## New Features\n"
            "- You can now search through all of your saved reports by name\n"
            "- Failed requests to the model are tried again a few times\n"
            "- We now keep a log of every job that was paused by a user\n"
            "- The list of reports loads faster when you have many of them\n\n"
            "## Bug Fixes\n"
            "- The monthly limit used to reset on the wrong day for some users\n"
            "- Long reports no longer lose their last section when exported\n"
        )

        assert calculate_flesch_reading_ease(senza_punti) > SOGLIA

    def test_la_e_muta_finale_non_conta_come_sillaba(self) -> None:
        """Le costanti della formula sono quelle inglesi, e in inglese la 'e' finale tace.

        Contandola, 'time' vale due sillabe invece di una e 'improved' tre
        invece di due: su un testo intero sono punti d'indice buttati.
        """
        # Cinque parole di una sillaba sola, tutte con la 'e' muta finale.
        # Se venisse contata, il testo risulterebbe di due sillabe per parola
        # e il punteggio crollerebbe sotto la soglia.
        testo = "Time make take place these. Time make take place these.\n"

        assert calculate_flesch_reading_ease(testo) > SOGLIA

    def test_la_prosa_aziendale_viene_ancora_respinta(self) -> None:
        """Il controllo deve restare un controllo.

        Le tre correzioni qui sopra rendono misurabile un testo scritto bene;
        non devono rendere accettabile un testo scritto male.
        """
        assert calculate_flesch_reading_ease(CHANGELOG_GONFIO) < SOGLIA


class TestContrattoDelParsing:
    """Cosa i profili restituiscono al grafo, che su quello fa `len()`."""

    def test_business_promuove_il_testo_leggibile(self) -> None:
        """Sopra soglia si ottengono i blocchi e la fase si chiude."""
        profilo = ChangelogBusinessProfile()
        blocchi, proposta, altra_fase = profilo.parse_output(
            CHANGELOG_PIANO, {"phase": "BUSINESS"}
        )

        assert len(blocchi) == 1
        assert proposta is None
        assert altra_fase is False

    def test_business_chiede_di_riscrivere_il_testo_pesante(self) -> None:
        """Sotto soglia si alza un ValueError riconoscibile dal grafo.

        E' la stringa READABILITY_RETRY che il nodo di validazione cerca per
        decidere se rimandare il testo al modello invece di fallire.
        """
        profilo = ChangelogBusinessProfile()
        try:
            profilo.parse_output(CHANGELOG_GONFIO, {"phase": "BUSINESS"})
        except ValueError as errore:
            assert "READABILITY_RETRY" in str(errore)
        else:
            raise AssertionError("un testo sotto soglia e' stato accettato")

    def test_policy_restituisce_una_coppia_anche_senza_violazioni(self) -> None:
        """Il caso che mandava a fondo ogni Verifica Policy.

        Il metodo finiva senza `return` e restituiva None; il grafo ci faceva
        sopra `len()` e ogni scansione moriva con "object of type 'NoneType'
        has no len()", qualunque fosse il repository.
        """
        profilo = SecurityPolicyProfile()
        risultato = profilo.parse_output('{"findings": []}', {})

        assert risultato is not None, "parse_output non restituisce niente"
        blocchi, proposta = risultato
        assert blocchi == []
        assert proposta is None

    def test_policy_restituisce_i_blocchi_delle_violazioni(self) -> None:
        """E con le violazioni dentro, restituisce quelle."""
        grezzo = """{
            "findings": [
                {
                    "ruleId": "NO-PLAINTEXT-SECRETS",
                    "ruleText": "I segreti non stanno nel sorgente",
                    "filePath": "src/config.ts",
                    "start_line": 12,
                    "end_line": 12,
                    "severity": "high",
                    "explanation": "Chiave API scritta in chiaro",
                    "remediation": {"kind": "TEXT", "text": "Spostala in una variabile"}
                }
            ]
        }"""

        blocchi, proposta = SecurityPolicyProfile().parse_output(grezzo, {})

        assert proposta is None
        assert len(blocchi) == 1
        violazione = blocchi[0]
        assert isinstance(violazione, PolicyViolationBlock)
        assert violazione.ruleId == "NO-PLAINTEXT-SECRETS"
        assert violazione.severity == "HIGH"
        assert violazione.lineStart == 12
