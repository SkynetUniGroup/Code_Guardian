"""Lettura delle metriche di qualita' da un'istanza SonarQube/SonarCloud.

Le metriche sono calcolate da SonarQube al momento della sua analisi, non da
noi: qui si legge il risultato per un progetto a un dato commit e lo si mette in
cache, perche' e' un dato che per uno stesso commit non cambia mai piu'.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
import redis.asyncio as aioredis

from .config import settings

logger = logging.getLogger(__name__)

_METRICS = [
    "complexity",
    "cognitive_complexity",
    "code_smells",
    "duplicated_lines_density",
    "security_hotspots",
]

_METRIC_LABELS: dict[str, str] = {
    "complexity": "Complessita' ciclomatica",
    "cognitive_complexity": "Complessita' cognitiva",
    "code_smells": "Code smells",
    "duplicated_lines_density": "Duplicazione (%)",
    "security_hotspots": "Security hotspot",
}

_REDIS_PREFIX = "sonarqube"

_HTTP_TIMEOUT_S = 30.0

# Quante voci mostrare quando nessun file modificato compare fra le metriche:
# meglio un estratto che una sezione vuota, ma senza riversare nel prompt le
# metriche di un intero repository.
_PROMPT_FALLBACK_LIMIT = 20


def cache_key(project_key: str, commit_sha: str) -> str:
    """Compone la chiave Redis delle metriche di un commit.

    Funzione a livello di modulo, e non metodo privato del servizio, perche'
    la usa anche l'endpoint che invalida la cache: due punti che scrivono lo
    stesso formato a mano divergerebbero senza che nulla se ne accorga, e
    l'invalidazione fallirebbe in silenzio.

    Args:
        project_key (str): Chiave del progetto su SonarQube.
        commit_sha (str): Commit di riferimento.

    Returns:
        str: La chiave della cache.
    """
    return f"{_REDIS_PREFIX}:{project_key}:{commit_sha}"


class SonarQubeCredentials:
    """Coordinate di accesso a un progetto SonarQube."""

    def __init__(
        self,
        instance_url: str,
        project_key: str,
        token: str,
        organization_key: str | None = None,
    ) -> None:
        """Inizializza le credenziali.

        Args:
            instance_url (str): URL dell'istanza SonarQube o SonarCloud.
            project_key (str): Chiave del progetto.
            token (str): Token di accesso.
            organization_key (str | None): Organizzazione, richiesta da SonarCloud.
        """
        self.instance_url = instance_url.rstrip("/")
        self.project_key = project_key
        self.token = token
        self.organization_key = organization_key

    @classmethod
    def from_dict(cls, data: dict) -> SonarQubeCredentials:
        """Costruisce le credenziali dalla forma con cui viaggiano sul filo.

        Args:
            data (dict): Oggetto con instanceUrl, projectKey, token e
                facoltativamente organizationKey.

        Returns:
            SonarQubeCredentials: Le credenziali.
        """
        return cls(
            instance_url=data["instanceUrl"],
            project_key=data["projectKey"],
            token=data["token"],
            organization_key=data.get("organizationKey"),
        )


class SonarQubeService:
    """Legge le metriche di un progetto, con cache su Redis."""

    def __init__(self, redis_client: aioredis.Redis) -> None:
        """Inizializza il servizio.

        Args:
            redis_client (aioredis.Redis): Connessione usata per la cache.
        """
        self._redis = redis_client

    async def get_metrics(
        self, credentials: SonarQubeCredentials, commit_sha: str
    ) -> dict[str, Any]:
        """Restituisce le metriche per file, dalla cache quando possibile.

        La cache e' sicura per costruzione: la chiave contiene il commit, e le
        metriche di un commit non cambiano piu'. Il TTL serve solo a non tenere
        per sempre i dati di commit che nessuno riguardera'.

        Args:
            credentials (SonarQubeCredentials): Accesso al progetto.
            commit_sha (str): Commit di riferimento.

        Returns:
            dict[str, Any]: Metriche indicizzate per percorso di file.
        """
        key = cache_key(credentials.project_key, commit_sha)

        cached = await self._redis.get(key)
        if cached:
            logger.debug("Metriche SonarQube da cache: %s", key)
            return json.loads(cached)

        data = await self._fetch_metrics(credentials)
        await self._redis.set(key, json.dumps(data), ex=settings.sonar_cache_ttl_s)
        logger.info(
            "Metriche SonarQube lette e messe in cache: progetto=%s commit=%s",
            credentials.project_key,
            commit_sha,
        )
        return data

    async def _fetch_metrics(self, credentials: SonarQubeCredentials) -> dict[str, Any]:
        """Interroga l'API di SonarQube.

        Args:
            credentials (SonarQubeCredentials): Accesso al progetto.

        Returns:
            dict[str, Any]: Metriche per file.

        Raises:
            ValueError: Token rifiutato o progetto inesistente — due casi che
                il chiamante deve poter distinguere da un guasto dell'istanza.
            httpx.HTTPStatusError: Per ogni altro codice di errore.
        """
        url = f"{credentials.instance_url}/api/measures/component_tree"
        params: dict[str, Any] = {
            "component": credentials.project_key,
            "metricKeys": ",".join(_METRICS),
            "qualifiers": "FIL",
            "ps": 500,
        }
        if credentials.organization_key:
            params["organization"] = credentials.organization_key

        # SonarQube autentica con il token come nome utente e password vuota.
        auth = (credentials.token, "")

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
            response = await client.get(url, params=params, auth=auth)

        if response.status_code == 401:
            raise ValueError("Autenticazione SonarQube fallita: controlla il token")
        if response.status_code == 404:
            raise ValueError(f"Progetto SonarQube non trovato: {credentials.project_key}")
        response.raise_for_status()

        return self._parse_component_tree(response.json())

    @staticmethod
    def _parse_component_tree(payload: dict) -> dict[str, Any]:
        """Appiattisce la risposta in una mappa percorso -> metriche.

        Args:
            payload (dict): Risposta di /api/measures/component_tree.

        Returns:
            dict[str, Any]: Metriche numeriche per file; i file senza alcuna
            misura vengono omessi.
        """
        result: dict[str, Any] = {}
        for component in payload.get("components", []):
            path = component.get("path") or component.get("key", "")
            file_metrics: dict[str, Any] = {}
            for measure in component.get("measures", []):
                metric = measure.get("metric", "")
                value = measure.get("value")
                if value is None:
                    continue
                try:
                    file_metrics[metric] = float(value)
                except (ValueError, TypeError):
                    file_metrics[metric] = value
            if file_metrics:
                result[path] = file_metrics
        return result

    @staticmethod
    def format_for_prompt(metrics_by_file: dict[str, Any], changed_files: list[str]) -> str:
        """Rende le metriche nella sezione di prompt per l'agente.

        Args:
            metrics_by_file (dict[str, Any]): Metriche per file.
            changed_files (list[str]): File dello scope dell'analisi.

        Returns:
            str: La sezione Markdown, vuota se non ci sono metriche.
        """
        if not metrics_by_file:
            return ""

        relevant = {
            path: metrics
            for path, metrics in metrics_by_file.items()
            if any(changed in path for changed in changed_files)
        }
        if not relevant:
            relevant = dict(list(metrics_by_file.items())[:_PROMPT_FALLBACK_LIMIT])

        lines: list[str] = ["### Metriche SonarQube per i file in analisi\n"]
        for path, metrics in relevant.items():
            lines.append(f"**{path}**")
            for metric, value in metrics.items():
                lines.append(f"  - {_METRIC_LABELS.get(metric, metric)}: {value}")
            lines.append("")

        return "\n".join(lines)
