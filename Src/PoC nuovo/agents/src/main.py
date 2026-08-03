from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from .config import settings
from .github_toolset import GitHubToolset
from .graph import AgentGraph
from .llm import get_llm_provider
from .agents.docs import DocsLoader, DocsProfile
from .agents.security import SecurityLoader, SecurityProfile
from .agents.changelog import ChangelogLoader, ChangelogProfile

app = FastAPI(
    title="Code Guardian Agents API",
    description="Servizio Python interno per l'esecuzione dei workflow LangGraph.",
    version="1.0.0"
)

class ContextRef(BaseModel):
    repoOwner: str
    repoName: str
    ref: str
    scopeType: str
    paths: Optional[List[str]] = []
    sprint_id: Optional[str] = "Sprint Attuale" # Utile per Changelog

class AgentRunRequest(BaseModel):
    taskId: str 
    userId: str
    operation: Optional[str] = None
    context_ref: ContextRef

@app.post("/agents/docs/run")
async def run_docs_agent(request: AgentRunRequest):
    toolset = GitHubToolset(user_id=request.userId, task_id=request.taskId)
    provider = get_llm_provider()
    graph = AgentGraph(DocsLoader(), DocsProfile(), provider)
    try:
        report = await graph.run(request.taskId, request.userId, request.context_ref, toolset)
        if isinstance(report, dict):
            return report
        return report.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/agents/security/run")
async def run_security_agent(request: AgentRunRequest):
    toolset = GitHubToolset(user_id=request.userId, task_id=request.taskId)
    provider = get_llm_provider()
    
    op = request.operation or "SECURITY_OWASP" 
    graph = AgentGraph(SecurityLoader(), SecurityProfile(operation=op), provider)
    try:
        report = await graph.run(request.taskId, request.userId, request.context_ref, toolset)
        if isinstance(report, dict):
            return report
        return report.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/agents/changelog/run")
async def run_changelog_agent(request: AgentRunRequest):
    toolset = GitHubToolset(user_id=request.userId, task_id=request.taskId)
    provider = get_llm_provider()
    graph = AgentGraph(ChangelogLoader(), ChangelogProfile(), provider)
    try:
        report = await graph.run(request.taskId, request.userId, request.context_ref, toolset)
        if isinstance(report, dict):
            return report
        return report.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "ok", "provider": settings.llm_provider}
