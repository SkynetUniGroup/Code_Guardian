<<<<<<< HEAD
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
=======
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI
from langgraph.checkpoint.mongodb.aio import AsyncMongoDBSaver
from langgraph.types import Command
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from .agents.changelog import (
    ChangelogBusinessProfile,
    ChangelogLoader,
    ChangelogTechnicalProfile,
)
from .agents.docs import DocsApiProfile, DocsInlineProfile, DocsLoader, DocsReadmeProfile
from .agents.security import OwaspScanProfile, SecurityLoader, SecurityPolicyProfile
from .config import settings
from .github_toolset import GitHubToolset
from .graph import AgentGraph, AgentState
from .llm import get_llm_provider
from .models import AgentStepResult, ResumeAgentRequest, StartAgentRequest


class ContextRef(BaseModel):
    """Represents the context reference for the agent operations."""
    repoOwner: str
    repoName: str
    repoUrl: str
    branch: str
    resolvedSha: str
    scopeType: str
    paths: Optional[List[str]] = []


checkpointer: AsyncMongoDBSaver = None
mongo_client: AsyncIOMotorClient = None
>>>>>>> origin/develop


@asynccontextmanager
async def lifespan(app: FastAPI):
<<<<<<< HEAD
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
=======
    """Manages the lifespan of the FastAPI application."""
    global mongo_client, checkpointer
    mongo_client = AsyncIOMotorClient(settings.mongo_uri)
    checkpointer = AsyncMongoDBSaver(mongo_client, db_name='codeguardian')
    yield
    mongo_client.close()


app = FastAPI(title='Code Guardian Agents API', lifespan=lifespan)


@app.get('/health')
async def health_check():
    """Provides a health check endpoint for the API.

    Returns:
        dict: The status and the current LLM provider.
    """
    return {'status': 'ok', 'provider': settings.llm_provider}


def get_agent_components(op_code: str):
    """Instantiates the loader, profile, and timeout based on the operation.

    Args:
        op_code (str): The operation code.

    Returns:
        tuple: A tuple containing the loader, profile, and timeout.

    Raises:
        ValueError: If the operation code is not supported.
    """
    if op_code.startswith('DOCS'):
        loader = DocsLoader(operation=op_code)
        if op_code == 'DOCS_API':
            profile = DocsApiProfile()
        elif op_code == 'DOCS_README':
            profile = DocsReadmeProfile()
        else:
            profile = DocsInlineProfile()
    elif op_code.startswith('SECURITY'):
        loader = SecurityLoader(operation=op_code)
        profile = SecurityPolicyProfile() if op_code == 'SECURITY_POLICY' else OwaspScanProfile()
    elif op_code.startswith('CHANGELOG'):
        loader = ChangelogLoader(operation=op_code)
        if op_code == 'CHANGELOG_BUSINESS':
            profile = ChangelogBusinessProfile()
        else:
            profile = ChangelogTechnicalProfile()
    else:
        raise ValueError(f'Unsupported operation: {op_code}')

    timeout = settings.TIMEOUTS_BY_OPERATION.get(op_code, 90)
    return loader, profile, timeout


@app.post('/internal/agent/start', response_model=AgentStepResult)
async def start_agent(request: StartAgentRequest):
    """Starts a new agent execution step."""
    
    user_id = request.payload.get('userId')
    if not user_id:
        return AgentStepResult(status='failed', error="Missing mandatory 'userId' in payload")

    try:
        loader, profile, timeout = get_agent_components(request.operationCode)
    except ValueError as e:
        return AgentStepResult(status='failed', error=str(e))

    toolset = GitHubToolset(user_id=user_id, task_id=request.taskId)

    is_security = request.operationCode.startswith('SECURITY')
    provider = get_llm_provider(
        model=settings.llm_model_security if is_security else settings.llm_model_general,
        temperature=settings.security_temperature if is_security else None,
        max_tokens=settings.security_max_output_tokens if is_security else None
    )

    graph = AgentGraph(
        loader, profile, provider, timeout_s=timeout, checkpointer=checkpointer
    )

    raw_context = request.payload.get('context_ref', {})
    try:
        context_obj = ContextRef(**raw_context)
    except Exception as e:
        return AgentStepResult(status='failed', error=f'Malformed ContextRef: {str(e)}')

    initial_state = AgentState(
        user_id=user_id,  
        task_id=request.taskId,
        context_ref=context_obj,
        toolset=toolset,
        agent_payload=request.payload
    )

    return await graph.execute_step(initial_state=initial_state, thread_id=request.threadId)


@app.post('/internal/agent/resume', response_model=AgentStepResult)
async def resume_agent(request: ResumeAgentRequest):
    """Resumes a suspended agent execution.

    Args:
        request (ResumeAgentRequest): The payload containing resume parameters.

    Returns:
        AgentStepResult: The result of the resumed agent execution.
    """
    try:
        loader, profile, timeout = get_agent_components(request.operationCode)
    except ValueError as e:
        return AgentStepResult(status='failed', error=str(e))

    toolset = GitHubToolset(user_id=request.userId, task_id=request.taskId)

    is_security = request.operationCode.startswith('SECURITY')
    provider = get_llm_provider(
        model=settings.llm_model_security if is_security else settings.llm_model_general,
        temperature=settings.security_temperature if is_security else None,
        max_tokens=settings.security_max_output_tokens if is_security else None
    )

    graph = AgentGraph(
        loader, profile, provider, timeout_s=timeout, checkpointer=checkpointer
    )

    resume_cmd = Command(resume=request.inputValue)
    return await graph.execute_step(resume_command=resume_cmd, thread_id=request.threadId)
>>>>>>> origin/develop
