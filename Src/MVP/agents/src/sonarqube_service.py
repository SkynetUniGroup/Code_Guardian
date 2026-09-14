"""Reading quality metrics from a SonarQube/SonarCloud instance.

The metrics are computed by SonarQube at the time of its own analysis, not by
us: here the result is read for a project at a given commit and cached,
because for the same commit it never changes again.
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
    "complexity": "Cyclomatic complexity",
    "cognitive_complexity": "Cognitive complexity",
    "code_smells": "Code smells",
    "duplicated_lines_density": "Duplication (%)",
    "security_hotspots": "Security hotspot",
}

_REDIS_PREFIX = "sonarqube"

_HTTP_TIMEOUT_S = 30.0

# How many entries to show when no modified file appears among the metrics:
# an excerpt is better than an empty section, but without pouring the
# metrics of an entire repository into the prompt.
_PROMPT_FALLBACK_LIMIT = 20


def cache_key(project_key: str, commit_sha: str) -> str:
    """Composes the Redis cache key for a commit's metrics.

    A module-level function, not a private method of the service, because
    the cache-invalidation endpoint also uses it: two points writing the
    same format by hand would diverge without anyone noticing, and the
    invalidation would fail silently.

    Args:
        project_key (str): Project key on SonarQube.
        commit_sha (str): Reference commit.

    Returns:
        str: The cache key.
    """
    return f"{_REDIS_PREFIX}:{project_key}:{commit_sha}"


class SonarQubeCredentials:
    """Access credentials for a SonarQube project."""

    def __init__(
        self,
        instance_url: str,
        project_key: str,
        token: str,
        organization_key: str | None = None,
    ) -> None:
        """Initializes the credentials.

        Args:
            instance_url (str): URL of the SonarQube or SonarCloud instance.
            project_key (str): Project key.
            token (str): Access token.
            organization_key (str | None): Organization, required by SonarCloud.
        """
        self.instance_url = instance_url.rstrip("/")
        self.project_key = project_key
        self.token = token
        self.organization_key = organization_key

    @classmethod
    def from_dict(cls, data: dict) -> SonarQubeCredentials:
        """Builds the credentials from the wire format.

        Args:
            data (dict): Object with instanceUrl, projectKey, token and
                optionally organizationKey.

        Returns:
            SonarQubeCredentials: The credentials.
        """
        return cls(
            instance_url=data["instanceUrl"],
            project_key=data["projectKey"],
            token=data["token"],
            organization_key=data.get("organizationKey"),
        )


class SonarQubeService:
    """Reads a project's metrics, with Redis caching."""

    def __init__(self, redis_client: aioredis.Redis) -> None:
        """Initializes the service.

        Args:
            redis_client (aioredis.Redis): Connection used for caching.
        """
        self._redis = redis_client

    async def get_metrics(
        self, credentials: SonarQubeCredentials, commit_sha: str
    ) -> dict[str, Any]:
        """Returns metrics per file, from cache when possible.

        The cache is safe by construction: the key contains the commit, and
        the metrics of a commit never change again. The TTL only prevents
        keeping forever the data of commits no one will look at again.

        Args:
            credentials (SonarQubeCredentials): Access to the project.
            commit_sha (str): Reference commit.

        Returns:
            dict[str, Any]: Metrics indexed by file path.
        """
        key = cache_key(credentials.project_key, commit_sha)

        cached = await self._redis.get(key)
        if cached:
            logger.debug("SonarQube metrics from cache: %s", key)
            return json.loads(cached)

        data = await self._fetch_metrics(credentials)
        await self._redis.set(key, json.dumps(data), ex=settings.sonar_cache_ttl_s)
        logger.info(
            "SonarQube metrics read and cached: project=%s commit=%s",
            credentials.project_key,
            commit_sha,
        )
        return data

    async def _fetch_metrics(self, credentials: SonarQubeCredentials) -> dict[str, Any]:
        """Queries the SonarQube API.

        Args:
            credentials (SonarQubeCredentials): Access to the project.

        Returns:
            dict[str, Any]: Metrics per file.

        Raises:
            ValueError: Token rejected or project not found -- two cases that
                the caller must be able to distinguish from an instance failure.
            httpx.HTTPStatusError: For any other error code.
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

        # SonarQube authenticates with the token as username and empty password.
        auth = (credentials.token, "")

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
            response = await client.get(url, params=params, auth=auth)

        if response.status_code == 401:
            raise ValueError("SonarQube authentication failed: check the token")
        if response.status_code == 404:
            raise ValueError(f"SonarQube project not found: {credentials.project_key}")
        response.raise_for_status()

        return self._parse_component_tree(response.json())

    @staticmethod
    def _parse_component_tree(payload: dict) -> dict[str, Any]:
        """Flattens the response into a path -> metrics map.

        Args:
            payload (dict): Response of /api/measures/component_tree.

        Returns:
            dict[str, Any]: Numeric metrics per file; files without any
            measurement are omitted.
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
        """Renders the metrics in the prompt section for the agent.

        Args:
            metrics_by_file (dict[str, Any]): Metrics per file.
            changed_files (list[str]): Files in the analysis scope.

        Returns:
            str: The Markdown section, empty if there are no metrics.
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

        lines: list[str] = ["### SonarQube metrics for files under analysis\n"]
        for path, metrics in relevant.items():
            lines.append(f"**{path}**")
            for metric, value in metrics.items():
                lines.append(f"  - {_METRIC_LABELS.get(metric, metric)}: {value}")
            lines.append("")

        return "\n".join(lines)
