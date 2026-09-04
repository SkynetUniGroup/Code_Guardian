from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import settings
from .github_toolset import GitHubToolset
from .graph import AgentGraph
from .agents.changelog import ChangelogLoader, ChangelogProfile
from .agents.docs import DocsLoader, DocsProfile
from .agents.security import SecurityLoader, SecurityProfile
from .llm import get_llm_provider
from .sast_analyzer import SASTAnalyzer
from .sonarqube_service import SonarQubeService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

_redis_client: aioredis.Redis | None = None
_sonar_service: SonarQubeService | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _redis_client, _sonar_service
    _redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    _sonar_service = SonarQubeService(_redis_client)
    logger.info("Servizio avviato — SonarQube=%s SAST=%s", settings.enable_sonarqube, settings.enable_sast_semgrep)
    yield
    if _redis_client:
        await _redis_client.aclose()


app = FastAPI(title="Code Guardian Agents", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Request / Response DTOs
# ---------------------------------------------------------------------------

class ContextRef(BaseModel):
    repoOwner: str
    repoName: str
    ref: str
    scopeType: str = "FULL_REPOSITORY"
    paths: list[str] = Field(default_factory=list)
    changedFiles: list[str] = Field(default_factory=list)


class RunRequest(BaseModel):
    taskId: str
    userId: str
    contextRef: ContextRef


class SonarQubeMetricsRequest(BaseModel):
    projectKey: str
    commitSha: str
    instanceUrl: str
    token: str
    organizationKey: str | None = None


class SonarCacheInvalidateRequest(BaseModel):
    projectKey: str
    commitSha: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_toolset(request: RunRequest) -> GitHubToolset:
    return GitHubToolset(user_id=request.userId, task_id=request.taskId)


def _serialise(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    return str(obj)


# ---------------------------------------------------------------------------
# Agent endpoints
# ---------------------------------------------------------------------------

@app.post("/agents/docs/run")
async def run_docs(request: RunRequest):
    toolset = _build_toolset(request)
    loader = DocsLoader(sonarqube_service=_sonar_service if settings.enable_sonarqube else None)
    profile = DocsProfile()
    provider = get_llm_provider()
    graph = AgentGraph(loader=loader, profile=profile, provider=provider)
    result = await graph.run(
        task_id=request.taskId,
        user_id=request.userId,
        context_ref=request.contextRef,
        toolset=toolset,
    )
    return JSONResponse(content=_serialise(result))


@app.post("/agents/security/run")
async def run_security(request: RunRequest):
    toolset = _build_toolset(request)
    sast = SASTAnalyzer() if settings.enable_sast_semgrep else None
    loader = SecurityLoader(operation="SECURITY_OWASP", sast_analyzer=sast)
    profile = SecurityProfile(operation="SECURITY_OWASP")
    provider = get_llm_provider()
    graph = AgentGraph(loader=loader, profile=profile, provider=provider)
    result = await graph.run(
        task_id=request.taskId,
        user_id=request.userId,
        context_ref=request.contextRef,
        toolset=toolset,
    )
    return JSONResponse(content=_serialise(result))


@app.post("/agents/changelog/run")
async def run_changelog(request: RunRequest):
    toolset = _build_toolset(request)
    loader = ChangelogLoader()
    profile = ChangelogProfile()
    provider = get_llm_provider()
    graph = AgentGraph(loader=loader, profile=profile, provider=provider)
    result = await graph.run(
        task_id=request.taskId,
        user_id=request.userId,
        context_ref=request.contextRef,
        toolset=toolset,
    )
    return JSONResponse(content=_serialise(result))


@app.post("/agents/policy/run")
async def run_policy(request: RunRequest):
    toolset = _build_toolset(request)
    loader = SecurityLoader(operation="SECURITY_POLICY")
    profile = SecurityProfile(operation="SECURITY_POLICY")
    provider = get_llm_provider()
    graph = AgentGraph(loader=loader, profile=profile, provider=provider)
    result = await graph.run(
        task_id=request.taskId,
        user_id=request.userId,
        context_ref=request.contextRef,
        toolset=toolset,
    )
    return JSONResponse(content=_serialise(result))


# ---------------------------------------------------------------------------
# SonarQube REST endpoints
# ---------------------------------------------------------------------------

@app.post("/sonarqube/metrics")
async def sonarqube_metrics(request: SonarQubeMetricsRequest):
    if not _sonar_service:
        raise HTTPException(status_code=503, detail="SonarQube service non inizializzato")

    from .sonarqube_service import SonarQubeCredentials
    creds = SonarQubeCredentials(
        instance_url=request.instanceUrl,
        project_key=request.projectKey,
        token=request.token,
        organization_key=request.organizationKey,
    )
    try:
        metrics = await _sonar_service.get_metrics(creds, request.commitSha)
        return {"projectKey": request.projectKey, "commitSha": request.commitSha, "metrics": metrics}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Errore SonarQube: %s", exc)
        raise HTTPException(status_code=502, detail="Errore upstream SonarQube")


@app.delete("/sonarqube/cache")
async def sonarqube_cache_invalidate(request: SonarCacheInvalidateRequest):
    if not _redis_client:
        raise HTTPException(status_code=503, detail="Redis non disponibile")
    key = f"sonarqube:{request.projectKey}:{request.commitSha}"
    deleted = await _redis_client.delete(key)
    return {"deleted": bool(deleted), "key": key}


@app.get("/sonarqube/cache/status")
async def sonarqube_cache_status(projectKey: str, commitSha: str):
    if not _redis_client:
        raise HTTPException(status_code=503, detail="Redis non disponibile")
    key = f"sonarqube:{projectKey}:{commitSha}"
    ttl = await _redis_client.ttl(key)
    exists = ttl != -2
    return {"projectKey": projectKey, "commitSha": commitSha, "cached": exists, "ttlSeconds": ttl if exists else None}


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    redis_ok = False
    if _redis_client:
        try:
            await _redis_client.ping()
            redis_ok = True
        except Exception:
            pass
    return {
        "status": "ok",
        "redis": redis_ok,
        "features": {
            "sonarqube": settings.enable_sonarqube,
            "sast_semgrep": settings.enable_sast_semgrep,
        },
    }
