"""Test di unita' per src/github_toolset.py: la Facade che il Python invoca
per parlare col backend NestJS, firmando ogni richiesta con HMAC-SHA256
(Appendice C). Nessuna vera richiesta HTTP viene mai effettuata: 'httpx'
viene sostituito con un client finto in memoria, cosi' possiamo verificare
sia la correttezza della firma sia la forma esatta dei payload inviati.
"""

import hashlib
import hmac
import json

import pytest

from src.config import settings as global_settings
from src.github_toolset import GitHubToolset


class FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json_data = json_data or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._json_data


class FakeAsyncClient:
    """Sostituisce httpx.AsyncClient: registra l'ultima richiesta inviata e
    restituisce una risposta pre-programmata."""

    captured_requests = []
    next_response = FakeResponse(200, {"ok": True})

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, content, headers, timeout):
        FakeAsyncClient.captured_requests.append(
            {"url": url, "content": content, "headers": headers, "timeout": timeout}
        )
        return FakeAsyncClient.next_response


@pytest.fixture
def fake_httpx_client(monkeypatch):
    FakeAsyncClient.captured_requests = []
    FakeAsyncClient.next_response = FakeResponse(200, {"ok": True})
    monkeypatch.setattr("src.github_toolset.httpx.AsyncClient", FakeAsyncClient)
    return FakeAsyncClient


@pytest.fixture
def patched_toolset(monkeypatch):
    original_secret = global_settings.internal_shared_secret
    original_base_url = global_settings.backend_base_url
    object.__setattr__(global_settings, "internal_shared_secret", "shared-secret-test")
    object.__setattr__(global_settings, "backend_base_url", "http://backend-test:3000")

    toolset = GitHubToolset(user_id="user-1", task_id="task-1")

    yield toolset

    object.__setattr__(global_settings, "internal_shared_secret", original_secret)
    object.__setattr__(global_settings, "backend_base_url", original_base_url)


class TestHmacSignatureCorrectness:
    """Verifica che ogni richiesta sia firmata esattamente come previsto
    dall'Appendice C: HMAC-SHA256 su 'timestamp.rawBody', con rawBody in
    JSON compatto (senza spazi) per combaciare col rawBody letto da NestJS."""

    @pytest.mark.asyncio
    async def test_signature_matches_manually_computed_hmac_over_timestamp_and_body(
        self, fake_httpx_client, patched_toolset
    ):
        await patched_toolset.read_tree("acme", "demo", "sha1")

        sent = fake_httpx_client.captured_requests[0]
        timestamp = sent["headers"]["X-Timestamp"]
        raw_body = sent["content"]

        expected_signature = hmac.new(
            b"shared-secret-test",
            f"{timestamp}.{raw_body}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        assert sent["headers"]["X-Signature"] == expected_signature

    @pytest.mark.asyncio
    async def test_raw_body_is_compact_json_matching_the_payload(self, fake_httpx_client, patched_toolset):
        await patched_toolset.read_file("acme", "demo", "sha1", "src/a.ts")

        sent = fake_httpx_client.captured_requests[0]
        # json.dumps(..., separators=(',', ':')) non deve introdurre spazi
        assert " " not in sent["content"]
        assert json.loads(sent["content"]) == {
            "taskId": "task-1", "userId": "user-1",
            "owner": "acme", "repo": "demo", "sha": "sha1", "path": "src/a.ts",
        }


class TestToolsetEndpointsAndPayloads:
    """Verifica endpoint e forma del payload per ciascun metodo pubblico."""

    @pytest.mark.asyncio
    async def test_read_tree_targets_the_tree_endpoint(self, fake_httpx_client, patched_toolset):
        await patched_toolset.read_tree("acme", "demo", "sha1")
        assert fake_httpx_client.captured_requests[0]["url"] == "http://backend-test:3000/internal/github/tree"

    @pytest.mark.asyncio
    async def test_read_issues_includes_optional_filter_params(self, fake_httpx_client, patched_toolset):
        await patched_toolset.read_issues("acme", "demo", {"state": "closed"})

        sent = fake_httpx_client.captured_requests[0]
        assert sent["url"] == "http://backend-test:3000/internal/github/issues"
        assert json.loads(sent["content"])["filter"] == {"state": "closed"}

    @pytest.mark.asyncio
    async def test_read_issues_defaults_filter_to_empty_dict_when_omitted(self, fake_httpx_client, patched_toolset):
        await patched_toolset.read_issues("acme", "demo")

        assert json.loads(fake_httpx_client.captured_requests[0]["content"])["filter"] == {}

    @pytest.mark.asyncio
    async def test_report_progress_targets_the_task_specific_progress_endpoint(
        self, fake_httpx_client, patched_toolset
    ):
        FakeAsyncClient.next_response = FakeResponse(204)

        result = await patched_toolset.report_progress(stage="carica_contesto", percent=30)

        assert fake_httpx_client.captured_requests[0]["url"] == "http://backend-test:3000/internal/tasks/task-1/progress"
        # report_progress non propaga il risultato di _request (firma -> None)
        assert result is None

    @pytest.mark.asyncio
    async def test_http_error_status_propagates_as_exception(self, fake_httpx_client, patched_toolset):
        FakeAsyncClient.next_response = FakeResponse(500)

        with pytest.raises(RuntimeError, match="500"):
            await patched_toolset.read_tree("acme", "demo", "sha1")
