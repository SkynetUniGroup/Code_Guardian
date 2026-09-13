"""Test dell'analizzatore statico e del triage dei suoi finding.

Nessuno di questi test invoca Semgrep davvero: quello che va verificato qui e'
la parte che scriviamo noi — la normalizzazione dei risultati, la sandbox su
disco, e l'appaiamento fra i verdetti del modello e i finding a cui si
riferiscono. Il comportamento di Semgrep e' affare di Semgrep.
"""

from __future__ import annotations

import os
import tempfile

import pytest

from src.agents.security import OwaspScanProfile
from src.models import SastFindingBlock, SastSummaryBlock
from src.sast_analyzer import SASTAnalyzer


def make_finding(rule_id: str, path: str, line: int) -> SastFindingBlock:
    """Costruisce un finding minimo per i test.

    Args:
        rule_id (str): Identificativo della regola.
        path (str): Percorso del file.
        line (int): Riga.

    Returns:
        SastFindingBlock: Il finding.
    """
    return SastFindingBlock(
        ruleId=rule_id,
        owaspCategory="A03:2021 - Injection",
        severity="HIGH",
        ruleSeverity="ERROR",
        filePath=path,
        lineStart=line,
        message="messaggio",
    )


def _abilita_sonarqube(monkeypatch, docs_module) -> None:
    """Accende ENABLE_SONARQUBE per la durata di un test.

    `settings` e' un modello pydantic frozen: assegnare un campo solleva
    ValidationError. Si sostituisce quindi l'intero oggetto nel modulo con una
    copia che differisce per quel solo campo, lasciando reali tutti gli altri.

    Args:
        monkeypatch: La fixture di pytest.
        docs_module: Il modulo src.agents.docs.
    """
    monkeypatch.setattr(
        docs_module,
        "settings",
        docs_module.settings.model_copy(update={"enable_sonarqube": True}),
    )


class TestMapResult:
    """Normalizzazione di un risultato grezzo di Semgrep."""

    def test_mappa_i_campi_e_rende_il_percorso_relativo(self):
        analyzer = SASTAnalyzer()
        item = {
            "check_id": "python.lang.security.exec-detected",
            "path": "/tmp/cg_sast_x/src/runner.py",
            "start": {"line": 42},
            "extra": {
                "severity": "ERROR",
                "message": "  Detected exec().  ",
                "lines": "exec(user_input)",
                "metadata": {"owasp": ["A03:2021 - Injection"], "cwe": ["CWE-94"]},
            },
        }

        finding = analyzer._map_result(item, "/tmp/cg_sast_x")

        # Il percorso della directory temporanea non deve finire in un report
        # persistito: l'utente vedrebbe un percorso di sistema al posto del suo file.
        assert finding.filePath == "src/runner.py"
        assert finding.ruleId == "python.lang.security.exec-detected"
        assert finding.lineStart == 42
        assert finding.message == "Detected exec()."
        assert finding.cwe == "CWE-94"
        assert finding.verdict == "NEEDS_REVIEW"

    @pytest.mark.parametrize(
        ("semgrep", "atteso"),
        [("ERROR", "HIGH"), ("WARNING", "MEDIUM"), ("INFO", "INFO")],
    )
    def test_traduce_la_severita_nel_dominio_condiviso(self, semgrep: str, atteso: str):
        # Semgrep ha tre livelli, il report ne ha cinque: senza la traduzione il
        # filtro per severita' del frontend non funzionerebbe su questi blocchi.
        analyzer = SASTAnalyzer()
        item = {"check_id": "r", "path": "a.py", "start": {"line": 1}, "extra": {"severity": semgrep}}

        finding = analyzer._map_result(item, "")

        assert finding.severity == atteso
        assert finding.ruleSeverity == semgrep

    def test_severita_sconosciuta_ripiega_su_warning(self):
        analyzer = SASTAnalyzer()
        item = {"check_id": "r", "path": "a.py", "start": {"line": 1}, "extra": {"severity": "BOH"}}

        finding = analyzer._map_result(item, "")

        assert finding.ruleSeverity == "WARNING"

    def test_metadati_assenti_non_fanno_fallire_la_mappatura(self):
        analyzer = SASTAnalyzer()

        finding = analyzer._map_result({"check_id": "r", "start": {"line": 3}}, "")

        assert finding.owaspCategory == "OWASP-UNKNOWN"
        assert finding.cwe is None
        assert finding.filePath == "unknown"

    def test_tronca_uno_snippet_troppo_lungo(self):
        analyzer = SASTAnalyzer()
        item = {"check_id": "r", "path": "a.py", "start": {"line": 1}, "extra": {"lines": "x" * 500}}

        finding = analyzer._map_result(item, "")

        assert len(finding.codeSnippet) == 300
        assert finding.codeSnippet.endswith("...")


class TestWriteFiles:
    """La sandbox su disco: e' l'unico punto in cui scriviamo codice altrui."""

    def test_scrive_i_file_dello_scope(self):
        analyzer = SASTAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            written = analyzer._write_files(tmpdir, {"src/app.py": "x = 1", "main.py": "y = 2"})

            assert sorted(written) == ["main.py", "src/app.py"]
            assert os.path.exists(os.path.join(tmpdir, "src", "app.py"))

    @pytest.mark.parametrize("percorso", ["../fuori.py", "../../etc/passwd", "/etc/passwd"])
    def test_rifiuta_i_percorsi_che_escono_dalla_sandbox(self, percorso: str):
        # I percorsi vengono dall'albero di un repository di terzi: uno costruito
        # ad arte non deve poter far scrivere l'analizzatore fuori da tmpdir.
        analyzer = SASTAnalyzer()
        with tempfile.TemporaryDirectory() as tmpdir:
            written = analyzer._write_files(tmpdir, {percorso: "codice", "ok.py": "x = 1"})

            assert written == ["ok.py"]


class TestDedupEOrdinamento:
    """Deduplicazione e priorita' con cui i finding arrivano al modello."""

    def test_distingue_la_stessa_regola_su_righe_diverse(self):
        # Due violazioni della stessa regola in punti diversi sono due problemi
        # da sistemare: comprimerle in una ne nasconderebbe una all'utente.
        findings = [
            make_finding("r", "a.py", 10),
            make_finding("r", "a.py", 10),
            make_finding("r", "a.py", 99),
        ]

        unici = SASTAnalyzer._dedup(findings)

        assert [f.lineStart for f in unici] == [10, 99]

    def test_ordina_per_severita_nativa(self):
        info = make_finding("i", "a.py", 1)
        info.ruleSeverity = "INFO"
        warning = make_finding("w", "a.py", 2)
        warning.ruleSeverity = "WARNING"
        error = make_finding("e", "a.py", 3)

        ordinati = SASTAnalyzer._sort_by_severity([info, warning, error])

        assert [f.ruleSeverity for f in ordinati] == ["ERROR", "WARNING", "INFO"]


class TestAnalyze:
    """Comportamento dell'analisi nel suo insieme."""

    async def test_nessun_file_produce_un_riepilogo_a_zero(self):
        findings, summary = await SASTAnalyzer().analyze({})

        assert findings == []
        assert summary is not None
        assert summary.totalFindings == 0

    async def test_semgrep_mancante_non_fa_fallire_il_task(self, monkeypatch):
        # Se il binario non c'e', l'operazione deve proseguire con il solo LLM:
        # e' il comportamento che si aveva prima che il SAST esistesse.
        async def esplodi(*_args, **_kwargs):
            raise FileNotFoundError("semgrep")

        analyzer = SASTAnalyzer()
        monkeypatch.setattr(analyzer, "_run_semgrep", esplodi)

        findings, summary = await analyzer.analyze({"a.py": "x = 1"})

        # summary None, non un riepilogo a zero: quest'ultimo si leggerebbe come
        # "nessuna vulnerabilita' trovata" invece che "analisi non eseguita".
        assert findings == []
        assert summary is None

    async def test_timeout_produce_risultati_parziali_marcati(self, monkeypatch):
        import asyncio

        async def lentissimo(*_args, **_kwargs):
            await asyncio.sleep(10)
            return []

        analyzer = SASTAnalyzer(timeout_s=1)
        monkeypatch.setattr(analyzer, "_run_semgrep", lentissimo)

        _findings, summary = await analyzer.analyze({"a.py": "x = 1"})

        assert summary is not None
        assert summary.timedOut is True

    async def test_applica_il_tetto_ai_finding_sottoposti_al_modello(self, monkeypatch):
        async def molti(*_args, **_kwargs):
            return [
                {
                    "check_id": f"r{i}",
                    "path": "a.py",
                    "start": {"line": i},
                    "extra": {"severity": "ERROR"},
                }
                for i in range(10)
            ]

        analyzer = SASTAnalyzer(max_findings=3)
        monkeypatch.setattr(analyzer, "_run_semgrep", molti)

        findings, summary = await analyzer.analyze({"a.py": "x = 1"})

        assert len(findings) == 3
        # Il totale resta quello vero: il tetto riguarda cosa vede il modello,
        # non quanto ha trovato lo strumento.
        assert summary.totalFindings == 10
        assert summary.cappedFindings == 7
        assert [f.order for f in findings] == [0, 1, 2]


class TestFormatForPrompt:
    """La sezione che finisce nel prompt del modello."""

    def test_vuota_quando_non_ci_sono_finding(self):
        summary = SastSummaryBlock(totalFindings=0)

        assert SASTAnalyzer().format_for_prompt([], summary) == ""

    def test_riporta_regola_percorso_e_riga(self):
        finding = make_finding("python.exec", "src/a.py", 42)
        summary = SastSummaryBlock(totalFindings=1, scannedFiles=1)

        testo = SASTAnalyzer().format_for_prompt([finding], summary)

        assert "python.exec" in testo
        assert "src/a.py" in testo
        assert "42" in testo

    def test_segnala_un_taglio_o_un_timeout(self):
        summary = SastSummaryBlock(totalFindings=50, cappedFindings=10, timedOut=True)

        testo = SASTAnalyzer().format_for_prompt([make_finding("r", "a.py", 1)], summary)

        assert "timeout" in testo.lower()
        assert "10 finding esclusi" in testo


class TestApplyVerdicts:
    """Appaiamento fra i verdetti del modello e i finding di Semgrep."""

    def test_appaia_per_regola_file_e_riga(self):
        findings = [make_finding("r", "a.py", 42), make_finding("r", "a.py", 99)]
        ctx = {"sast_findings": findings, "sast_summary": SastSummaryBlock(totalFindings=2)}
        data = {
            "sast_verdicts": [
                {"rule_id": "r", "file": "a.py", "line": 42, "verdict": "CONFIRMED"},
                {"rule_id": "r", "file": "a.py", "line": 99, "verdict": "FALSE_POSITIVE"},
            ]
        }

        blocchi = OwaspScanProfile._apply_sast_verdicts(data, ctx)

        assert [b.verdict for b in blocchi[1:]] == ["CONFIRMED", "FALSE_POSITIVE"]

    def test_verdetto_per_sola_regola_solo_se_non_ambiguo(self):
        # Una regola violata due volte, e un verdetto che non dice dove: applicarlo
        # a entrambe significherebbe attribuire a un'occorrenza un giudizio dato
        # sull'altra.
        findings = [make_finding("dup", "a.py", 1), make_finding("dup", "a.py", 2)]
        ctx = {"sast_findings": findings, "sast_summary": SastSummaryBlock(totalFindings=2)}

        blocchi = OwaspScanProfile._apply_sast_verdicts(
            {"sast_verdicts": [{"rule_id": "dup", "verdict": "FALSE_POSITIVE"}]}, ctx
        )

        assert [b.verdict for b in blocchi[1:]] == ["NEEDS_REVIEW", "NEEDS_REVIEW"]

    def test_verdetto_per_sola_regola_si_applica_se_unica(self):
        findings = [make_finding("solo", "a.py", 1)]
        ctx = {"sast_findings": findings, "sast_summary": SastSummaryBlock(totalFindings=1)}

        blocchi = OwaspScanProfile._apply_sast_verdicts(
            {"sast_verdicts": [{"rule_id": "solo", "verdict": "CONFIRMED"}]}, ctx
        )

        assert blocchi[1].verdict == "CONFIRMED"

    def test_finding_non_citato_resta_da_rivedere(self):
        findings = [make_finding("r", "a.py", 1)]
        ctx = {"sast_findings": findings, "sast_summary": SastSummaryBlock(totalFindings=1)}

        blocchi = OwaspScanProfile._apply_sast_verdicts({"sast_verdicts": []}, ctx)

        assert blocchi[1].verdict == "NEEDS_REVIEW"

    def test_verdetto_non_riconosciuto_ripiega_su_da_rivedere(self):
        findings = [make_finding("r", "a.py", 1)]
        ctx = {"sast_findings": findings, "sast_summary": SastSummaryBlock(totalFindings=1)}

        blocchi = OwaspScanProfile._apply_sast_verdicts(
            {"sast_verdicts": [{"rule_id": "r", "file": "a.py", "line": 1, "verdict": "BOH"}]}, ctx
        )

        assert blocchi[1].verdict == "NEEDS_REVIEW"

    def test_ricalcola_il_riepilogo_e_lo_mette_in_testa(self):
        findings = [make_finding("a", "x.py", 1), make_finding("b", "x.py", 2)]
        ctx = {
            "sast_findings": findings,
            "sast_summary": SastSummaryBlock(totalFindings=2, needsReview=2),
        }
        data = {
            "sast_verdicts": [
                {"rule_id": "a", "file": "x.py", "line": 1, "verdict": "CONFIRMED"},
                {"rule_id": "b", "file": "x.py", "line": 2, "verdict": "FALSE_POSITIVE"},
            ]
        }

        blocchi = OwaspScanProfile._apply_sast_verdicts(data, ctx)

        riepilogo = blocchi[0]
        assert riepilogo.kind == "SAST_SUMMARY"
        assert riepilogo.order == 0
        assert (riepilogo.confirmedFindings, riepilogo.falsePositives, riepilogo.needsReview) == (
            1,
            1,
            0,
        )

    def test_riporta_il_rimedio_suggerito_dal_modello(self):
        findings = [make_finding("r", "a.py", 1)]
        ctx = {"sast_findings": findings, "sast_summary": SastSummaryBlock(totalFindings=1)}

        blocchi = OwaspScanProfile._apply_sast_verdicts(
            {
                "sast_verdicts": [
                    {
                        "rule_id": "r",
                        "file": "a.py",
                        "line": 1,
                        "verdict": "CONFIRMED",
                        "remediation": "usa una query parametrizzata",
                    }
                ]
            },
            ctx,
        )

        assert blocchi[1].llmRemediation == "usa una query parametrizzata"

    def test_senza_sast_non_produce_blocchi(self):
        assert OwaspScanProfile._apply_sast_verdicts({"sast_verdicts": []}, {}) == []


class TestDocsLoaderSonarQube:
    """Metriche SonarQube nel contesto dell'agente Docs.

    La chiave `sonarqube_credentials` nel payload non viene ancora inviata da
    nessuno: il backend costruisce il payload con userId, context_ref e al piu'
    sprintId. Questi test fissano il comportamento perche' il giorno in cui
    quella chiave arrivera' non ci sia da indovinare cosa succede.
    """

    def test_senza_servizio_non_chiede_metriche(self):
        import asyncio

        from src.agents.docs import DocsLoader

        loader = DocsLoader(operation="DOCS_INLINE")

        assert asyncio.run(loader._load_sonarqube_metrics({"sonarqube_credentials": {}}, "sha")) is None

    def test_senza_credenziali_nel_payload_non_chiede_metriche(self, monkeypatch):
        import asyncio

        from src.agents import docs as docs_module
        from src.agents.docs import DocsLoader

        _abilita_sonarqube(monkeypatch, docs_module)

        class ServizioCheEsplode:
            async def get_metrics(self, *_args, **_kwargs):
                raise AssertionError("non deve essere chiamato")

        loader = DocsLoader(operation="DOCS_INLINE", sonarqube_service=ServizioCheEsplode())

        assert asyncio.run(loader._load_sonarqube_metrics({}, "sha")) is None

    def test_un_guasto_di_sonarqube_non_ferma_la_documentazione(self, monkeypatch):
        import asyncio

        from src.agents import docs as docs_module
        from src.agents.docs import DocsLoader

        _abilita_sonarqube(monkeypatch, docs_module)

        class ServizioRotto:
            async def get_metrics(self, *_args, **_kwargs):
                raise RuntimeError("istanza irraggiungibile")

        loader = DocsLoader(operation="DOCS_INLINE", sonarqube_service=ServizioRotto())
        credenziali = {"instanceUrl": "https://s.example.com", "projectKey": "p", "token": "t"}

        # Degrado silenzioso: None, non un'eccezione.
        assert asyncio.run(loader._load_sonarqube_metrics({"sonarqube_credentials": credenziali}, "sha")) is None

    def test_restituisce_le_metriche_quando_tutto_e_a_posto(self, monkeypatch):
        import asyncio

        from src.agents import docs as docs_module
        from src.agents.docs import DocsLoader

        _abilita_sonarqube(monkeypatch, docs_module)
        attese = {"src/a.py": {"complexity": 12.0}}

        class ServizioOk:
            async def get_metrics(self, credentials, commit_sha):
                assert credentials.project_key == "p"
                assert commit_sha == "abc123"
                return attese

        loader = DocsLoader(operation="DOCS_INLINE", sonarqube_service=ServizioOk())
        credenziali = {"instanceUrl": "https://s.example.com/", "projectKey": "p", "token": "t"}

        assert (
            asyncio.run(
                loader._load_sonarqube_metrics({"sonarqube_credentials": credenziali}, "abc123")
            )
            == attese
        )


class TestDocsPromptConMetriche:
    """Le metriche devono comparire nel prompt, e solo quando ci sono."""

    def test_prompt_invariato_senza_metriche(self):
        from src.agents.docs import _with_sonarqube

        assert _with_sonarqube({"code_units": "x"}, "CODICE") == "CODICE"
        assert _with_sonarqube({"sonarqube_metrics": None}, "CODICE") == "CODICE"

    def test_le_metriche_precedono_il_codice(self):
        from src.agents.docs import _with_sonarqube

        ctx = {
            "sonarqube_metrics": {"src/a.py": {"complexity": 12.0}},
            "sonarqube_scope_files": ["src/a.py"],
        }

        out = _with_sonarqube(ctx, "CODICE")

        assert "Metriche SonarQube" in out
        assert "src/a.py" in out
        # Il codice resta in fondo, intatto.
        assert out.endswith("CODICE")
