import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException
from langgraph.checkpoint.mongodb.aio import AsyncMongoDBSaver
from langgraph.types import Command
from pydantic import BaseModel
from pymongo import AsyncMongoClient

from .agents.changelog import (
    ChangelogBusinessProfile,
    ChangelogLoader,
    ChangelogTechnicalProfile,
)
from .agents.docs import (
    DocsApiProfile,
    DocsInlineProfile,
    DocsLoader,
    DocsReadmeProfile,
)
from .agents.security import OwaspScanProfile, SecurityLoader, SecurityPolicyProfile
from .config import settings
from .graph import AgentGraph, AgentState
from .llm import get_llm_provider
from .models import AgentStepResult, ResumeAgentRequest, StartAgentRequest
from .sast_analyzer import SASTAnalyzer
from .sonarqube_service import SonarQubeCredentials, SonarQubeService, cache_key


class ContextRef(BaseModel):
    """Represents the context reference for the agent operations."""

    repoOwner: str
    repoName: str
    repoUrl: str
    branch: str
    resolvedSha: str
    scopeType: str
    paths: list[str] | None = []


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

checkpointer: AsyncMongoDBSaver = None
mongo_client: AsyncMongoClient = None
redis_client: aioredis.Redis = None
sonar_service: SonarQubeService = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manages the lifespan of the FastAPI application."""
    global mongo_client, checkpointer, redis_client, sonar_service

    # Async pymongo client, not motor.
    #
    # AsyncMongoDBSaver calls `client.append_metadata()` in its own
    # constructor -- a method that exists on AsyncMongoClient (since pymongo
    # 4.14) and not on AsyncIOMotorClient. With motor the attribute was
    # interpreted as a database name and the service died at startup with
    # "MotorDatabase object is not callable".
    #
    # This is not a fallback: motor is deprecated by MongoDB in favor of
    # pymongo's async API, which is what the library expects.
    mongo_client = AsyncMongoClient(settings.mongo_uri)
    checkpointer = AsyncMongoDBSaver(mongo_client, db_name="codeguardian")

    # Service Redis connection, used by the SonarQube cache. The graph
    # opens its own connection per step instead (see
    # AgentGraph.execute_step): its lifetime is that of the invocation,
    # not that of the process.
    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    if settings.enable_sonarqube:
        sonar_service = SonarQubeService(redis_client)

    logger.info(
        "Service started -- SAST=%s SonarQube=%s",
        settings.enable_sast_semgrep,
        settings.enable_sonarqube,
    )

    yield

    # await: on AsyncMongoClient close() is a coroutine, while on motor it
    # was synchronous. Without it, the close would remain an un-awaited
    # coroutine and the connection would not be released.
    await mongo_client.close()
    if redis_client:
        await redis_client.aclose()


app = FastAPI(title="Code Guardian Agents API", lifespan=lifespan)


@app.get("/health")
async def health_check():
    """Provides a health check endpoint for the API.

    Returns:
        dict: The status, the LLM provider, and the active optional features.
    """
    return {
        "status": "ok",
        "provider": settings.llm_provider,
        "features": {
            "sast_semgrep": settings.enable_sast_semgrep,
            "sonarqube": settings.enable_sonarqube,
        },
    }


def get_agent_components(op_code: str):
    """Instantiates the loader, profile, and timeout based on the operation.

    Args:
        op_code (str): The operation code.

    Returns:
        tuple: A tuple containing the loader, profile, and timeout.

    Raises:
        ValueError: If the operation code is not supported.
    """
    if op_code.startswith("DOCS"):
        # `sonar_service` is None when ENABLE_SONARQUBE is false (see the
        # lifespan): the loader notices and proceeds without metrics.
        loader = DocsLoader(operation=op_code, sonarqube_service=sonar_service)
        if op_code == "DOCS_API":
            profile = DocsApiProfile()
        elif op_code == "DOCS_README":
            profile = DocsReadmeProfile()
        else:
            profile = DocsInlineProfile()
    elif op_code.startswith("SECURITY"):
        # The analyzer is constructed here and not inside the loader: this
        # is the only point where it is decided whether the feature is
        # active, and passing it as a dependency makes the loader testable
        # without Semgrep installed.
        sast = SASTAnalyzer() if settings.enable_sast_semgrep else None
        loader = SecurityLoader(operation=op_code, sast_analyzer=sast)
        profile = (
            SecurityPolicyProfile()
            if op_code == "SECURITY_POLICY"
            else OwaspScanProfile()
        )
    elif op_code.startswith("CHANGELOG"):
        loader = ChangelogLoader(operation=op_code)
        if op_code == "CHANGELOG_BUSINESS":
            profile = ChangelogBusinessProfile()
        else:
            profile = ChangelogTechnicalProfile()
    else:
        raise ValueError(f"Unsupported operation: {op_code}")

    timeout = settings.TIMEOUTS_BY_OPERATION.get(op_code, 90)
    return loader, profile, timeout


@app.post("/internal/agent/start", response_model=AgentStepResult)
async def start_agent(request: StartAgentRequest):
    """Starts a new agent execution step."""

    user_id = request.payload.get("userId")
    if not user_id:
        return AgentStepResult(
            status="failed", error="Missing mandatory 'userId' in payload"
        )

    try:
        loader, profile, timeout = get_agent_components(request.operationCode)
    except ValueError as e:
        return AgentStepResult(status="failed", error=str(e))

    is_security = request.operationCode.startswith("SECURITY")
    provider = get_llm_provider(
        model=(
            settings.llm_model_security if is_security else settings.llm_model_general
        ),
        temperature=settings.security_temperature if is_security else None,
        max_tokens=(
            settings.security_max_output_tokens
            if is_security
            else settings.docs_api_max_output_tokens
            if request.operationCode == "DOCS_API"
            else None
        ),
    )

    graph = AgentGraph(
        loader, profile, provider, timeout_s=timeout, checkpointer=checkpointer
    )

    raw_context = request.payload.get("context_ref", {})
    try:
        context_obj = ContextRef(**raw_context)
    except Exception as e:
        return AgentStepResult(status="failed", error=f"Malformed ContextRef: {e!s}")

    # The toolset does not enter the state: AgentGraph reconstructs it at
    # every node from user_id and task_id, so the HMAC secret it carries
    # does not end up in the MongoDB checkpoints. See AgentState.
    initial_state = AgentState(
        user_id=user_id,
        task_id=request.taskId,
        context_ref=context_obj,
        agent_payload=request.payload,
    )

    return await graph.execute_step(
        initial_state=initial_state, thread_id=request.threadId
    )


@app.post("/internal/agent/resume", response_model=AgentStepResult)
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
        return AgentStepResult(status="failed", error=str(e))

    is_security = request.operationCode.startswith("SECURITY")
    provider = get_llm_provider(
        model=(
            settings.llm_model_security if is_security else settings.llm_model_general
        ),
        temperature=settings.security_temperature if is_security else None,
        max_tokens=(
            settings.security_max_output_tokens
            if is_security
            else settings.docs_api_max_output_tokens
            if request.operationCode == "DOCS_API"
            else None
        ),
    )

    graph = AgentGraph(
        loader, profile, provider, timeout_s=timeout, checkpointer=checkpointer
    )

    resume_cmd = Command(resume=request.inputValue)
    return await graph.execute_step(
        resume_command=resume_cmd, thread_id=request.threadId
    )


# ---------------------------------------------------------------------------
# SonarQube
#
# Under /internal like the agent routes, for a precise reason: they accept
# a SonarQube token in the request body and have no authentication of their
# own. They hold only because this service is not exposed to the host
# (docker-compose: `agents` publishes no ports) and is reachable only
# from inside the Docker network. The prefix makes it explicit instead of
# leaving it to be inferred.
#
# No agent calls them yet: the upstream piece is missing, i.e. a place to
# store SonarQube credentials per project (the backend currently accepts
# only the GITHUB provider). Until that exists, these routes serve to
# verify the connection to an instance and manage its cache.
# ---------------------------------------------------------------------------


class SonarQubeMetricsRequest(BaseModel):
    """Body of POST /internal/sonarqube/metrics."""

    projectKey: str
    commitSha: str
    instanceUrl: str
    token: str
    organizationKey: str | None = None


class SonarCacheInvalidateRequest(BaseModel):
    """Body of DELETE /internal/sonarqube/cache."""

    projectKey: str
    commitSha: str


def _require_sonar() -> SonarQubeService:
    """Returns the SonarQube service, or explains why it is not available.

    Returns:
        SonarQubeService: The service initialized at startup.

    Raises:
        HTTPException: 503 if the feature is disabled.
    """
    if sonar_service is None:
        raise HTTPException(
            status_code=503,
            detail="SonarQube not active: set ENABLE_SONARQUBE=true and restart the service.",
        )
    return sonar_service


def _require_redis() -> aioredis.Redis:
    """Returns the service Redis client.

    Returns:
        aioredis.Redis: The client opened at startup.

    Raises:
        HTTPException: 503 if the connection is not available.
    """
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Redis not available")
    return redis_client


@app.post("/internal/sonarqube/metrics")
async def sonarqube_metrics(request: SonarQubeMetricsRequest):
    """Reads the quality metrics of a project at a given commit.

    Args:
        request (SonarQubeMetricsRequest): Project, commit, and credentials.

    Returns:
        dict: Metrics per file, from cache when available.

    Raises:
        HTTPException: 400 if the credentials or project are invalid,
            502 for a SonarQube instance error.
    """
    service = _require_sonar()
    credentials = SonarQubeCredentials(
        instance_url=request.instanceUrl,
        project_key=request.projectKey,
        token=request.token,
        organization_key=request.organizationKey,
    )
    try:
        metrics = await service.get_metrics(credentials, request.commitSha)
    except ValueError as exc:
        # Token rejected or project not found: it is a request problem,
        # not a remote instance problem.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - any other failure is upstream
        logger.exception("SonarQube upstream error")
        raise HTTPException(status_code=502, detail="SonarQube upstream error") from exc

    return {
        "projectKey": request.projectKey,
        "commitSha": request.commitSha,
        "metrics": metrics,
    }


@app.delete("/internal/sonarqube/cache")
async def sonarqube_cache_invalidate(request: SonarCacheInvalidateRequest):
    """Invalidates the metrics cache for a project and a commit.

    Args:
        request (SonarCacheInvalidateRequest): Project and commit.

    Returns:
        dict: Whether the key existed and which key was removed.
    """
    redis = _require_redis()
    key = cache_key(request.projectKey, request.commitSha)
    deleted = await redis.delete(key)
    return {"deleted": bool(deleted), "key": key}


@app.get("/internal/sonarqube/cache/status")
async def sonarqube_cache_status(projectKey: str, commitSha: str):
    """Reports whether the metrics for a commit are in cache and for how long.

    Args:
        projectKey (str): SonarQube project key.
        commitSha (str): Reference commit.

    Returns:
        dict: Cache status and remaining TTL.
    """
    redis = _require_redis()
    key = cache_key(projectKey, commitSha)
    ttl = await redis.ttl(key)
    # ttl == -2 means "key does not exist"; -1 "no expiration".
    cached = ttl != -2
    return {
        "projectKey": projectKey,
        "commitSha": commitSha,
        "cached": cached,
        "ttlSeconds": ttl if cached and ttl >= 0 else None,
    }
