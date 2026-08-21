"""Strumenti per la comunicazione sicura con il backend NestJS (Facade GitHub).
Implementa la firma HMAC-SHA256 richiesta dall'Appendice C.
"""

import time
import hmac
import hashlib
import json
import httpx
from typing import Dict, Any, Optional

from .config import settings

class GitHubToolset:
    def __init__(self, user_id: str, task_id: str): 
        """
        Inizializza il toolset per uno specifico utente e task.
        """
        self.user_id = user_id
        self.task_id = task_id 
        self.base_url = settings.backend_base_url.rstrip("/")
        # Convertiamo il segreto in byte per HMAC
        self.secret = settings.internal_shared_secret.encode("utf-8")

    async def _request(self, endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Metodo base per inviare richieste firmate al backend."""
        
        # Convertiamo il payload in JSON compatto 
        # per assicurarci che combaci esattamente con il rawBody letto da NestJS
        raw_body = json.dumps(payload, separators=(',', ':'))
        timestamp = str(int(time.time() * 1000))

        # Costruiamo il messaggio da firmare: "timestamp.rawBody"
        message = f"{timestamp}.{raw_body}".encode("utf-8")
        
        # Calcoliamo l'hash HMAC-SHA256 in formato esadecimale
        signature = hmac.new(self.secret, message, hashlib.sha256).hexdigest()

        headers = {
            "Content-Type": "application/json",
            "X-Timestamp": timestamp,
            "X-Signature": signature
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}{endpoint}",
                content=raw_body,
                headers=headers,
                timeout=30.0  # Timeout ragionevole per letture da GitHub
            )
            
            response.raise_for_status()
            
            # Se è un 204 No Content (es. per update_progress), restituiamo un dict vuoto
            if response.status_code == 204:
                return {}
                
            return response.json()


    async def read_tree(self, owner: str, repo: str, sha: str) -> Dict[str, Any]:
        """Recupera l'albero dei file del repository."""
        payload = {
            "taskId": self.task_id,
            "userId": self.user_id,
            "owner": owner,
            "repo": repo,
            "sha": sha
        }
        return await self._request("/internal/github/tree", payload)

    async def read_file(self, owner: str, repo: str, sha: str, path: str) -> Dict[str, Any]:
        """Recupera il contenuto di un singolo file."""
        payload = {
            "taskId": self.task_id,
            "userId": self.user_id,
            "owner": owner,
            "repo": repo,
            "sha": sha,
            "path": path
        }
        return await self._request("/internal/github/file", payload)

    async def read_issues(self, owner: str, repo: str, filter_params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Recupera le issue (utile per l'agente Changelog)."""
        payload = {
            "taskId": self.task_id,
            "userId": self.user_id,
            "owner": owner,
            "repo": repo,
            "filter": filter_params or {}
        }
        return await self._request("/internal/github/issues", payload)

    async def report_progress(self, stage: str, percent: int) -> None:
        """Invia un aggiornamento di stato alla UI tramite WebSocket del backend."""
        payload = {
            "stage": stage,
            "percent": percent
        }
        await self._request(f"/internal/tasks/{self.task_id}/progress", payload)