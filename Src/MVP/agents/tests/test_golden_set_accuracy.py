"""Tests for the security agent's accuracy using a Golden Set.

Verifies that the LLM model correctly identifies at least 85% of the
OWASP vulnerabilities exposed in the simulated files.
"""

import os
from typing import Any

import pytest

from src.config import settings
from src.agents.security import OwaspScanProfile, SecurityLoader
from src.github_toolset import GitHubToolset
from src.graph import AgentGraph, AgentState
from src.llm import get_llm_provider
from src.main import ContextRef


# Golden Set: 7 simulated files exposing a distinct OWASP Top 10 vulnerability each.
# To pass the test (>= 85%), the model must correctly identify at least 6 out of 7 (85.7%).
GOLDEN_SET = {
    'src/db.js': "const query = 'SELECT * FROM users WHERE id = ' + req.query.id; db.execute(query);",
    'src/secrets.py': "AWS_SECRET = 'AKIAIOSFODNN7EXAMPLE'",
    'src/view.js': "document.body.innerHTML = '<h1>' + new URLSearchParams(window.location.search).get('name') + '</h1>';",
    'src/proxy.py': "import requests\nrequests.get(request.args.get('url'))",
    'src/auth.ts': 'function deleteUser(req) { db.users.delete(req.body.userId); }',
    'src/crypto.py': 'import hashlib\nh = hashlib.md5()\nh.update(password.encode())\nreturn h.hexdigest()',
    'src/xml_parser.py': 'import xml.etree.ElementTree as ET\nET.parse(user_input_stream)'
}


class GoldenSetGitHubToolset(GitHubToolset):
    """Simulates the repository by providing Golden Set files directly.

    Bypasses external network calls to GitHub.
    """

    def __init__(self):
        """Initializes the mock toolset."""
        self.user_id = 'test'
        self.task_id = 'test'

    async def read_tree(self, owner: str, repo: str, sha: str) -> dict:
        """Simulates reading the repository tree.

        Args:
            owner (str): The repository owner.
            repo (str): The repository name.
            sha (str): The commit SHA.

        Returns:
            dict: The simulated tree structure.
        """
        return {'nodes': [{'path': path, 'type': 'file'} for path in GOLDEN_SET.keys()]}

    async def read_file(self, owner: str, repo: str, sha: str, path: str) -> dict:
        """Simulates reading a specific file.

        Args:
            owner (str): The repository owner.
            repo (str): The repository name.
            sha (str): The commit SHA.
            path (str): The file path.

        Returns:
            dict: The simulated file content.
        """
        return {'content': GOLDEN_SET.get(path, ''), 'path': path}

    async def report_progress(self, stage: str, percent: int) -> None:
        """Simulates reporting progress.

        Args:
            stage (str): The current stage.
            percent (int): The completion percentage.
        """
        pass


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get('LLM_API_KEY') and not os.environ.get('AWS_REGION'), 
    reason='Requires a real LLM (DashScope or Bedrock) to statistically measure accuracy (RQ.5).'
)
async def test_security_golden_set_accuracy() -> None:
    """Verifies accuracy (RQ.5) on the selected LLM provider.

    The agent must execute tool-calling to read files and identify 
    vulnerabilities, exceeding the 85% threshold.
    """
    toolset = GoldenSetGitHubToolset()
    
    # Initialize real LLM provider. Timeout and tokens adapted to scan load.
    provider = get_llm_provider(
        settings.llm_model_security, 
        temperature=0.1, 
        max_tokens=8000
    )
    
    graph = AgentGraph(
        loader=SecurityLoader(operation='SECURITY_OWASP'), 
        profile=OwaspScanProfile(), 
        provider=provider,
        timeout_s=300
    )
    
    mvp_context = ContextRef(
    repoOwner='test',
    repoName='golden-set',
    repoUrl='https://github.com/test/golden-set',
    branch='main',
    resolvedSha='golden0000sha',
    scopeType='FULL_REPOSITORY'
)
    
    # Setup initial state for the new AgentGraph API
    from src.graph import AgentState
    initial_state = AgentState(
        user_id='user-golden',
        task_id='task-golden',
        context_ref=mvp_context,
        toolset=toolset,
        agent_payload={}
    )

    # Execute agent graph and retrieve the report
    step_result = await graph.execute_step(initial_state=initial_state, thread_id='golden_thread')
    
    assert step_result['status'] == 'completed', f"Graph execution failed: {step_result.get('error')}"
    
    report = step_result['result']['report']
    assert report['status'] == 'COMPLETED', f"Report failed: {report.get('error')}"
    
    findings = report['body']
    found_vulns = set()
    
    # Evaluate and classify produced findings against the Golden Set
    for f in findings:
        if f.get('kind', '') != 'FINDING':
            continue
            
        desc = (f.get('category', '') + ' ' + f.get('description', '')).lower()
        path = f.get('filePath', '')
        
        if 'db.js' in path and ('sql' in desc or 'injection' in desc):
            found_vulns.add('SQLi')
        if 'secrets.py' in path and ('secret' in desc or 'hardcoded' in desc or 'key' in desc):
            found_vulns.add('Secrets')
        if 'view.js' in path and ('xss' in desc or 'cross-site' in desc):
            found_vulns.add('XSS')
        if 'proxy.py' in path and ('ssrf' in desc or 'forgery' in desc):
            found_vulns.add('SSRF')
        if 'auth.ts' in path and ('access' in desc or 'authorization' in desc or 'control' in desc):
            found_vulns.add('Broken Access Control')
        if 'crypto.py' in path and ('md5' in desc or 'crypto' in desc or 'hash' in desc):
            found_vulns.add('Weak Crypto')
        if 'xml_parser.py' in path and ('xxe' in desc or 'xml' in desc or 'entity' in desc):
            found_vulns.add('XXE')
            
    total_vulns = len(GOLDEN_SET)
    accuracy = (len(found_vulns) / total_vulns) * 100
    
    print(f'\nDetected accuracy: {accuracy:.1f}% ({len(found_vulns)}/{total_vulns})')
    print(f'Vulnerabilities found: {found_vulns}')
    
    assert accuracy >= 85.0, f'Accuracy {accuracy:.1f}% does not meet RQ.5 (>= 85%).'