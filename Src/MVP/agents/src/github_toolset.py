"""Tools for secure communication with the NestJS backend (GitHub Facade).

Implements the HMAC-SHA256 signature required for internal endpoints.
"""

import hashlib
import hmac
import json
import time
from typing import Any

import httpx

from .config import settings


class GitHubToolset:
    """Provides tools to interact with the backend's GitHub Facade securely."""

    def __init__(self, user_id: str, task_id: str):
        """Initializes the toolset for a specific user and task.

        Args:
            user_id (str): The ID of the user.
            task_id (str): The ID of the task.
        """
        self.user_id = user_id
        self.task_id = task_id
        self.base_url = settings.backend_base_url.rstrip("/")
        self.api_prefix = "/" + settings.backend_api_prefix.strip("/")
        # Convert the secret to bytes for HMAC processing
        self.secret = settings.internal_shared_secret.encode("utf-8")

    async def _request(self, endpoint: str, payload: dict[str, Any]) -> Any:
        """Base method to send signed requests to the backend.

        Args:
            endpoint (str): The API path, relative to the backend's global
                prefix (e.g. "/internal/github/tree").
            payload (Dict[str, Any]): The JSON payload to send.

        Returns:
            Any: The decoded JSON body returned by the backend — an object for
                the single-resource endpoints, a list for the collection ones.

        Raises:
            httpx.HTTPStatusError: If the backend returns an error status code.
        """
        # Convert payload to compact JSON to match the rawBody read by NestJS
        raw_body = json.dumps(payload, separators=(",", ":"))
        body_hash = hashlib.sha256(raw_body.encode("utf-8")).hexdigest()

        timestamp = str(int(time.time()))
        method = "POST"

        # The path has to include the backend's global prefix: InternalAuthGuard
        # signs Express's request.path, which is the full path as received, and a
        # signature computed over the bare "/internal/..." would never match.
        path = f"{self.api_prefix}{endpoint}"

        # Build the message to sign: "timestamp:method:path:bodyHash"
        message = f"{timestamp}:{method}:{path}:{body_hash}".encode()

        # Calculate the HMAC-SHA256 hash in hexadecimal format
        signature = hmac.new(self.secret, message, hashlib.sha256).hexdigest()

        headers = {
            "Content-Type": "application/json",
            "X-Internal-Timestamp": timestamp,
            "X-Internal-Signature": signature,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}{path}",
                content=raw_body,
                headers=headers,
                timeout=30.0,  # Reasonable timeout for reading from GitHub
            )

            response.raise_for_status()

            # If it's a 204 No Content (e.g., for update_progress), return an empty dict
            if response.status_code == 204:
                return {}

            return response.json()

    # Every method below sends `taskId` and nothing else about *which*
    # repository to read: the backend resolves owner/repo/commit/token from the
    # task itself (InternalTaskContextResolver). That is the whole point of the
    # facade — an agent cannot ask for a repository its task doesn't own — and
    # the internal DTOs enforce it, since the global ValidationPipe runs with
    # forbidNonWhitelisted and rejects any extra field outright.

    async def read_tree(self, owner: str, repo: str, sha: str) -> dict[str, Any]:
        """Retrieves the file tree of the repository.

        Args:
            owner (str): Unused — kept for call-site readability; the backend
                resolves it from the task.
            repo (str): Unused, same reason.
            sha (str): Unused, same reason.

        Returns:
            Dict[str, Any]: {"nodes": [...]} — the endpoint answers with a bare
                array, wrapped here so callers (and the LLM tool) get a named
                field instead of a positional list.
        """
        nodes = await self._request(
            "/internal/github/tree", {"taskId": self.task_id}
        )
        return {"nodes": nodes if isinstance(nodes, list) else []}

    async def read_file(
        self, owner: str, repo: str, sha: str, path: str
    ) -> dict[str, Any]:
        """Retrieves the content of a single file.

        Args:
            owner (str): Unused — resolved backend-side from the task.
            repo (str): Unused, same reason.
            sha (str): Unused, same reason.
            path (str): The path to the file inside the repository.

        Returns:
            Dict[str, Any]: The file content and metadata.
        """
        return await self._request(
            "/internal/github/file", {"taskId": self.task_id, "path": path}
        )

    async def read_issues(
        self, owner: str, repo: str, filter_params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Retrieves issues (useful for the Changelog agent).

        Args:
            owner (str): Unused — resolved backend-side from the task.
            repo (str): Unused, same reason.
            filter_params (Optional[Dict[str, Any]], optional): Supports
                "state" ("open" | "closed" | "all") and "issueNumber". Anything
                else is dropped rather than sent: the internal DTO rejects
                unknown fields.

        Returns:
            Dict[str, Any]: {"issues": [...]} for a listing, or {"issue": {...}}
                when a single issueNumber was requested.
        """
        filters = filter_params or {}
        payload: dict[str, Any] = {"taskId": self.task_id}
        if filters.get("state"):
            payload["state"] = filters["state"]
        if filters.get("issueNumber") is not None:
            payload["issueNumber"] = int(filters["issueNumber"])

        result = await self._request("/internal/github/issues", payload)
        if isinstance(result, list):
            return {"issues": result}
        return {"issues": [], "issue": result}

    async def report_progress(self, stage: str, percent: int) -> None:
        """Sends a status update to the UI via the backend's WebSocket.

        Args:
            stage (str): The current execution stage.
            percent (int): The completion percentage.
        """
        payload = {"stage": stage, "percent": percent}
        await self._request(f"/internal/tasks/{self.task_id}/progress", payload)
