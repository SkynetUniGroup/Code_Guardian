from __future__ import annotations

import json
import logging
from typing import Any, Optional

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

_REDIS_PREFIX = "sonarqube"


class SonarQubeCredentials:
    def __init__(self, instance_url: str, project_key: str, token: str, organization_key: Optional[str] = None):
        self.instance_url = instance_url.rstrip("/")
        self.project_key = project_key
        self.token = token
        self.organization_key = organization_key

    @classmethod
    def from_dict(cls, data: dict) -> "SonarQubeCredentials":
        return cls(
            instance_url=data["instanceUrl"],
            project_key=data["projectKey"],
            token=data["token"],
            organization_key=data.get("organizationKey"),
        )


class SonarQubeService:
    def __init__(self, redis_client: aioredis.Redis):
        self._redis = redis_client

    def _cache_key(self, project_key: str, commit_sha: str) -> str:
        return f"{_REDIS_PREFIX}:{project_key}:{commit_sha}"

    async def get_metrics(
        self,
        credentials: SonarQubeCredentials,
        commit_sha: str,
    ) -> dict[str, Any]:
        cache_key = self._cache_key(credentials.project_key, commit_sha)

        cached = await self._redis.get(cache_key)
        if cached:
            logger.debug("SonarQube cache hit for %s", cache_key)
            return json.loads(cached)

        data = await self._fetch_metrics(credentials)
        ttl = settings.sonar_cache_ttl_s
        await self._redis.set(cache_key, json.dumps(data), ex=ttl)
        logger.info("SonarQube metrics fetched and cached for project=%s commit=%s", credentials.project_key, commit_sha)
        return data

    async def _fetch_metrics(self, credentials: SonarQubeCredentials) -> dict[str, Any]:
        url = f"{credentials.instance_url}/api/measures/component_tree"
        params: dict[str, Any] = {
            "component": credentials.project_key,
            "metricKeys": ",".join(_METRICS),
            "qualifiers": "FIL",
            "ps": 500,
        }
        if credentials.organization_key:
            params["organization"] = credentials.organization_key

        auth = (credentials.token, "")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, params=params, auth=auth)

        if response.status_code == 401:
            raise ValueError("SonarQube authentication failed — check token")
        if response.status_code == 404:
            raise ValueError(f"SonarQube project not found: {credentials.project_key}")
        response.raise_for_status()

        payload = response.json()
        return self._parse_component_tree(payload)

    def _parse_component_tree(self, payload: dict) -> dict[str, Any]:
        result: dict[str, Any] = {}
        components = payload.get("components", [])
        for component in components:
            path = component.get("path") or component.get("key", "")
            measures = component.get("measures", [])
            file_metrics: dict[str, Any] = {}
            for m in measures:
                metric = m.get("metric", "")
                value = m.get("value")
                if value is not None:
                    try:
                        file_metrics[metric] = float(value)
                    except (ValueError, TypeError):
                        file_metrics[metric] = value
            if file_metrics:
                result[path] = file_metrics
        return result

    def format_for_prompt(self, metrics_by_file: dict[str, Any], changed_files: list[str]) -> str:
        if not metrics_by_file:
            return ""

        lines: list[str] = ["### Metriche SonarQube per i file modificati\n"]
        relevant = {k: v for k, v in metrics_by_file.items() if any(cf in k for cf in changed_files)}

        if not relevant:
            relevant = dict(list(metrics_by_file.items())[:20])

        for path, metrics in relevant.items():
            lines.append(f"**{path}**")
            for metric, value in metrics.items():
                label = _METRIC_LABELS.get(metric, metric)
                lines.append(f"  - {label}: {value}")
            lines.append("")

        return "\n".join(lines)


_METRIC_LABELS: dict[str, str] = {
    "complexity": "Complessità ciclomatica",
    "cognitive_complexity": "Complessità cognitiva",
    "code_smells": "Code smells",
    "duplicated_lines_density": "Duplicazione (%)",
    "security_hotspots": "Security hotspot",
}
