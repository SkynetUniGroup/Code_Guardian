"""Tools for secure communication with the NestJS backend (GitHub Facade).

Implements the HMAC-SHA256 signature required for internal endpoints.
"""

import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional

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
        self.base_url = settings.backend_base_url.rstrip('/')
        # Convert the secret to bytes for HMAC processing
        self.secret = settings.internal_shared_secret.encode('utf-8')

    async def _request(self, endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Base method to send signed requests to the backend.

        Args:
            endpoint (str): The API endpoint path.
            payload (Dict[str, Any]): The JSON payload to send.

        Returns:
            Dict[str, Any]: The JSON response from the backend.
            
        Raises:
            httpx.HTTPStatusError: If the backend returns an error status code.
        """
        # Convert payload to compact JSON to match the rawBody read by NestJS
        raw_body = json.dumps(payload, separators=(',', ':'))
        body_hash = hashlib.sha256(raw_body.encode('utf-8')).hexdigest()
        
        timestamp = str(int(time.time()))
        method = 'POST'

        # Build the message to sign: "timestamp:method:path:bodyHash"
        message = f'{timestamp}:{method}:{endpoint}:{body_hash}'.encode('utf-8')
        
        # Calculate the HMAC-SHA256 hash in hexadecimal format
        signature = hmac.new(self.secret, message, hashlib.sha256).hexdigest()

        headers = {
            'Content-Type': 'application/json',
            'X-Internal-Timestamp': timestamp,
            'X-Internal-Signature': signature
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f'{self.base_url}{endpoint}',
                content=raw_body,
                headers=headers,
                timeout=30.0  # Reasonable timeout for reading from GitHub
            )
            
            response.raise_for_status()
            
            # If it's a 204 No Content (e.g., for update_progress), return an empty dict
            if response.status_code == 204:
                return {}
                
            return response.json()

    async def read_tree(self, owner: str, repo: str, sha: str) -> Dict[str, Any]:
        """Retrieves the file tree of the repository.

        Args:
            owner (str): The owner of the repository.
            repo (str): The repository name.
            sha (str): The commit SHA to read the tree from.

        Returns:
            Dict[str, Any]: The repository tree data.
        """
        payload = {
            'taskId': self.task_id,
            'userId': self.user_id,
            'owner': owner,
            'repo': repo,
            'sha': sha
        }
        return await self._request('/internal/github/tree', payload)

    async def read_file(self, owner: str, repo: str, sha: str, path: str) -> Dict[str, Any]:
        """Retrieves the content of a single file.

        Args:
            owner (str): The owner of the repository.
            repo (str): The repository name.
            sha (str): The commit SHA.
            path (str): The path to the file inside the repository.

        Returns:
            Dict[str, Any]: The file content and metadata.
        """
        payload = {
            'taskId': self.task_id,
            'userId': self.user_id,
            'owner': owner,
            'repo': repo,
            'sha': sha,
            'path': path
        }
        return await self._request('/internal/github/file', payload)

    async def read_issues(
        self, owner: str, repo: str, filter_params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Retrieves issues (useful for the Changelog agent).

        Args:
            owner (str): The owner of the repository.
            repo (str): The repository name.
            filter_params (Optional[Dict[str, Any]], optional): Filters to apply. Defaults to None.

        Returns:
            Dict[str, Any]: The list of issues.
        """
        payload = {
            'taskId': self.task_id,
            'userId': self.user_id,
            'owner': owner,
            'repo': repo,
            'filter': filter_params or {}
        }
        return await self._request('/internal/github/issues', payload)

    async def report_progress(self, stage: str, percent: int) -> None:
        """Sends a status update to the UI via the backend's WebSocket.

        Args:
            stage (str): The current execution stage.
            percent (int): The completion percentage.
        """
        payload = {
            'stage': stage,
            'percent': percent
        }
        await self._request(f'/internal/tasks/{self.task_id}/progress', payload)