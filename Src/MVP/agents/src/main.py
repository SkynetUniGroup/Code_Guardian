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

    # Client async di pymongo, non motor.
    #
    # AsyncMongoDBSaver chiama `client.append_metadata()` nel proprio
    # costruttore — un metodo che esiste su AsyncMongoClient (da pymongo 4.14)
    # e non su AsyncIOMotorClient. Con motor l'attributo veniva interpretato
    # come nome di un database e il servizio moriva all'avvio con
    # "MotorDatabase object is not callable".
    #
    # Non e' un ripiego: motor e' deprecato da MongoDB proprio in favore
    # dell'API async di pymongo, che e' quella che la libreria si aspetta.
    mongo_client = AsyncMongoClient(settings.mongo_uri)
    checkpointer = AsyncMongoDBSaver(mongo_client, db_name="codeguardian")

    # Connessione Redis di servizio, usata dalla cache SonarQube. Il grafo
    # apre invece una propria connessione per ogni step (vedi
    # AgentGraph.execute_step): la sua vita e' quella dell'invocazione, non
    # quella del processo.
    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    if settings.enable_sonarqube:
        sonar_service = SonarQubeService(redis_client)

    logger.info(
        "Servizio avviato — SAST=%s SonarQube=%s",
        settings.enable_sast_semgrep,
        settings.enable_sonarqube,
    )

    yield

    # await: su AsyncMongoClient close() e' una coroutine, mentre su motor era
    # sincrona. Senza, la chiusura resterebbe una coroutine mai attesa e la
    # connessione non verrebbe rilasciata.
    await mongo_client.close()
    if redis_client:
        await redis_client.aclose()


app = FastAPI(title="Code Guardian Agents API", lifespan=lifespan)


@app.get("/health")
async def health_check():
    """Provides a health check endpoint for the API.

    Returns:
        dict: Lo stato, il provider LLM e le funzionalita' opzionali attive.
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
        # `sonar_service` e' None quando ENABLE_SONARQUBE e' false (vedi il
        # lifespan): il loader se ne accorge e prosegue senza metriche.
        loader = DocsLoader(operation=op_code, sonarqube_service=sonar_service)
        if op_code == "DOCS_API":
            profile = DocsApiProfile()
        elif op_code == "DOCS_README":
            profile = DocsReadmeProfile()
        else:
            profile = DocsInlineProfile()
    elif op_code.startswith("SECURITY"):
        # L'analizzatore viene costruito qui e non dentro il loader: e' l'unico
        # punto in cui si decide se la funzionalita' e' attiva, e passarlo come
        # dipendenza rende il loader verificabile senza Semgrep installato.
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
        max_tokens=settings.security_max_output_tokens if is_security else None,
    )

    graph = AgentGraph(
        loader, profile, provider, timeout_s=timeout, checkpointer=checkpointer
    )

    raw_context = request.payload.get("context_ref", {})
    try:
        context_obj = ContextRef(**raw_context)
    except Exception as e:
        return AgentStepResult(status="failed", error=f"Malformed ContextRef: {e!s}")

    # Il toolset non entra nello stato: lo ricostruisce AgentGraph a ogni nodo
    # a partire da user_id e task_id, cosi' il segreto HMAC che porta con se'
    # non finisce nei checkpoint su MongoDB. Vedi AgentState.
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
        max_tokens=settings.security_max_output_tokens if is_security else None,
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
# Sotto /internal come le rotte dell'agente, per una ragione precisa: accettano
# un token SonarQube nel corpo della richiesta e non hanno autenticazione
# propria. Reggono solo perche' questo servizio non e' esposto all'host
# (docker-compose: `agents` non pubblica porte) ed e' raggiungibile unicamente
# dall'interno della rete Docker. Il prefisso lo rende esplicito invece di
# lasciarlo dedurre.
#
# Nessun agente le chiama ancora: manca il pezzo a monte, cioe' un posto dove
# salvare le credenziali SonarQube per progetto (il backend accetta oggi il solo
# provider GITHUB). Finche' non c'e', queste rotte servono a verificare la
# connessione a un'istanza e a gestirne la cache.
# ---------------------------------------------------------------------------


class SonarQubeMetricsRequest(BaseModel):
    """Corpo di POST /internal/sonarqube/metrics."""

    projectKey: str
    commitSha: str
    instanceUrl: str
    token: str
    organizationKey: str | None = None


class SonarCacheInvalidateRequest(BaseModel):
    """Corpo di DELETE /internal/sonarqube/cache."""

    projectKey: str
    commitSha: str


def _require_sonar() -> SonarQubeService:
    """Restituisce il servizio SonarQube, o spiega perche' non c'e'.

    Returns:
        SonarQubeService: Il servizio inizializzato all'avvio.

    Raises:
        HTTPException: 503 se la funzionalita' e' disattivata.
    """
    if sonar_service is None:
        raise HTTPException(
            status_code=503,
            detail="SonarQube non attivo: imposta ENABLE_SONARQUBE=true e riavvia il servizio.",
        )
    return sonar_service


def _require_redis() -> aioredis.Redis:
    """Restituisce il client Redis di servizio.

    Returns:
        aioredis.Redis: Il client aperto all'avvio.

    Raises:
        HTTPException: 503 se la connessione non e' disponibile.
    """
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Redis non disponibile")
    return redis_client


@app.post("/internal/sonarqube/metrics")
async def sonarqube_metrics(request: SonarQubeMetricsRequest):
    """Legge le metriche di qualita' di un progetto a un dato commit.

    Args:
        request (SonarQubeMetricsRequest): Progetto, commit e credenziali.

    Returns:
        dict: Le metriche per file, dalla cache quando disponibili.

    Raises:
        HTTPException: 400 se le credenziali o il progetto non sono validi,
            502 per un errore dell'istanza SonarQube.
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
        # Token rifiutato o progetto inesistente: e' un problema di richiesta,
        # non dell'istanza remota.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - qualunque altro guasto e' upstream
        logger.exception("Errore upstream di SonarQube")
        raise HTTPException(status_code=502, detail="Errore upstream di SonarQube") from exc

    return {
        "projectKey": request.projectKey,
        "commitSha": request.commitSha,
        "metrics": metrics,
    }


@app.delete("/internal/sonarqube/cache")
async def sonarqube_cache_invalidate(request: SonarCacheInvalidateRequest):
    """Invalida la cache delle metriche per un progetto e un commit.

    Args:
        request (SonarCacheInvalidateRequest): Progetto e commit.

    Returns:
        dict: Se la chiave esisteva e quale chiave e' stata rimossa.
    """
    redis = _require_redis()
    key = cache_key(request.projectKey, request.commitSha)
    deleted = await redis.delete(key)
    return {"deleted": bool(deleted), "key": key}


@app.get("/internal/sonarqube/cache/status")
async def sonarqube_cache_status(projectKey: str, commitSha: str):
    """Dice se le metriche di un commit sono in cache e per quanto ancora.

    Args:
        projectKey (str): Chiave del progetto SonarQube.
        commitSha (str): Commit di riferimento.

    Returns:
        dict: Stato della cache e TTL residuo.
    """
    redis = _require_redis()
    key = cache_key(projectKey, commitSha)
    ttl = await redis.ttl(key)
    # ttl == -2 significa "chiave inesistente"; -1 "senza scadenza".
    cached = ttl != -2
    return {
        "projectKey": projectKey,
        "commitSha": commitSha,
        "cached": cached,
        "ttlSeconds": ttl if cached and ttl >= 0 else None,
    }
