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


@asynccontextmanager
async def lifespan(app: FastAPI):
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