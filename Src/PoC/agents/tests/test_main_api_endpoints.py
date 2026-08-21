"""Test di integrazione per gli endpoint FastAPI in src/main.py.

Usa Starlette/FastAPI TestClient per esercitare l'intera pila HTTP (routing,
validazione Pydantic della request, serializzazione della response) mentre
sostituisce 'AgentGraph' con un doppio di test che registra come e' stato
costruito (quale Loader/Profile/timeout) e restituisce un esito
pre-programmato: nessuna chiamata reale a LLM o a GitHub viene mai
effettuata.
"""

import pytest
from fastapi.testclient import TestClient

import src.main as main_module
from src.models import Report, TextBlock
from src.config import settings


class RecordingGraph:
    """Sostituto di AgentGraph: registra i parametri di costruzione e
    restituisce (o solleva) un esito programmato dal test."""

    constructions: list = []
    next_result = None

    def __init__(self, loader, profile, provider, timeout_s=None):
        RecordingGraph.constructions.append(
            {"loader": loader, "profile": profile, "provider": provider, "timeout_s": timeout_s}
        )

    async def run(self, task_id, user_id, context_ref, toolset):
        result = RecordingGraph.next_result
        if isinstance(result, Exception):
            raise result
        return result


@pytest.fixture(autouse=True)
def reset_recording_graph():
    RecordingGraph.constructions = []
    RecordingGraph.next_result = None
    yield


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main_module, "AgentGraph", RecordingGraph)
    monkeypatch.setattr(main_module, "get_llm_provider", lambda *args, **kwargs: object())
    return TestClient(main_module.app)


def make_request_body(operation=None):
    body = {
        "taskId": "task-1",
        "userId": "user-1",
        "context_ref": {
            "repoOwner": "acme",
            "repoName": "demo",
            "ref": "sha1",
            "scopeType": "FULL_REPOSITORY",
        },
    }
    if operation is not None:
        body["operation"] = operation
    return body


class TestHealthCheck:
    def test_health_endpoint_reports_configured_provider(self, client):
        response = client.get("/health")

        assert response.status_code == 200
        assert response.json() == {"status": "ok", "provider": settings.llm_provider}


class TestDocsAgentEndpoint:
    def test_returns_serialized_completed_report_on_success(self, client):
        RecordingGraph.next_result = Report(
            taskId="task-1", agentId="docs", operation="DOCS_INLINE",
            status="COMPLETED", summary="Fatto", body=[TextBlock(order=0, markdown="doc")],
        )

        response = client.post("/agents/docs/run", json=make_request_body())

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "COMPLETED"
        assert payload["agentId"] == "docs"
        assert payload["body"][0]["kind"] == "text"

    def test_propagates_unexpected_exceptions_as_http_500(self, client):
        RecordingGraph.next_result = RuntimeError("crash imprevisto nel grafo")

        response = client.post("/agents/docs/run", json=make_request_body())

        assert response.status_code == 500
        assert "crash imprevisto nel grafo" in response.json()["detail"]

    def test_missing_required_field_is_rejected_with_422(self, client):
        response = client.post("/agents/docs/run", json={"taskId": "task-1"})

        assert response.status_code == 422


class TestSecurityAgentEndpoint:
    def test_defaults_operation_to_security_owasp_when_not_provided(self, client):
        RecordingGraph.next_result = Report(
            taskId="task-1", agentId="security", operation="SECURITY_OWASP", status="COMPLETED",
        )

        client.post("/agents/security/run", json=make_request_body())

        profile = RecordingGraph.constructions[0]["profile"]
        assert profile.operation == "SECURITY_OWASP"
        assert RecordingGraph.constructions[0]["timeout_s"] == settings.security_agent_timeout_s

    def test_honours_explicit_security_policy_operation(self, client):
        RecordingGraph.next_result = Report(
            taskId="task-1", agentId="security", operation="SECURITY_POLICY", status="COMPLETED",
        )

        client.post("/agents/security/run", json=make_request_body(operation="SECURITY_POLICY"))

        assert RecordingGraph.constructions[0]["profile"].operation == "SECURITY_POLICY"

    def test_cooperative_cancellation_dict_is_returned_as_is(self, client):
        RecordingGraph.next_result = {"status": "CANCELLED", "stage": "carica_contesto"}

        response = client.post("/agents/security/run", json=make_request_body())

        assert response.status_code == 200
        assert response.json() == {"status": "CANCELLED", "stage": "carica_contesto"}


class TestChangelogAgentEndpoint:
    def test_returns_serialized_completed_report_on_success(self, client):
        RecordingGraph.next_result = Report(
            taskId="task-1", agentId="changelog", operation="CHANGELOG_TECHNICAL",
            status="COMPLETED", summary="Changelog generato",
        )

        response = client.post("/agents/changelog/run", json=make_request_body())

        assert response.status_code == 200
        assert response.json()["agentId"] == "changelog"

    def test_propagates_unexpected_exceptions_as_http_500(self, client):
        RecordingGraph.next_result = ValueError("errore inatteso nel changelog")

        response = client.post("/agents/changelog/run", json=make_request_body())

        assert response.status_code == 500
