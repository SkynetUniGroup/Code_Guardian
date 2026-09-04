from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, Optional

import httpx

from .config import settings


class GitHubToolset:
    def __init__(self, user_id: str, task_id: str):
        self.user_id = user_id
        self.task_id = task_id
        self.base_url = settings.backend_base_url.rstrip("/")
        self._secret = settings.internal_shared_secret.encode("utf-8")

    async def _request(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        raw_body = json.dumps(payload, separators=(",", ":"))
        timestamp = str(int(time.time() * 1000))
        message = f"{timestamp}.{raw_body}".encode("utf-8")
        signature = hmac.new(self._secret, message, hashlib.sha256).hexdigest()

        headers = {
            "Content-Type": "application/json",
            "X-Timestamp": timestamp,
            "X-Signature": signature,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}{endpoint}",
                content=raw_body,
                headers=headers,
                timeout=30.0,
            )
            response.raise_for_status()
            if response.status_code == 204:
                return {}
            return response.json()

    async def read_tree(self, owner: str, repo: str, sha: str) -> dict[str, Any]:
        return await self._request(
            "/internal/github/tree",
            {"taskId": self.task_id, "userId": self.user_id, "owner": owner, "repo": repo, "sha": sha},
        )

    async def read_file(self, owner: str, repo: str, sha: str, path: str) -> dict[str, Any]:
        return await self._request(
            "/internal/github/file",
            {"taskId": self.task_id, "userId": self.user_id, "owner": owner, "repo": repo, "sha": sha, "path": path},
        )

    async def read_issues(self, owner: str, repo: str, filter_params: Optional[dict] = None) -> dict[str, Any]:
        return await self._request(
            "/internal/github/issues",
            {"taskId": self.task_id, "userId": self.user_id, "owner": owner, "repo": repo, "filter": filter_params or {}},
        )

    async def report_progress(self, stage: str, percent: int) -> None:
        await self._request(
            f"/internal/tasks/{self.task_id}/progress",
            {"stage": stage, "percent": percent},
        )

    async def get_sonarqube_credentials(self) -> Optional[dict[str, Any]]:
        try:
            return await self._request(
                "/internal/credentials/sonarqube",
                {"taskId": self.task_id, "userId": self.user_id},
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            raise
