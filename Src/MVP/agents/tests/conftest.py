"""Pytest configuration and fixtures for MVP agent tests.

Provides mock implementations for LLM and GitHub toolsets.
"""

from typing import Any, List, Union

import pytest
from langchain_core.messages import AIMessage, BaseMessage

from src.github_toolset import GitHubToolset
from src.llm import LLMProvider
from src.main import ContextRef


class MockLLMProvider(LLMProvider):
    """Mock provider for the MVP.
    
    Accepts a list of text responses or Exceptions to simulate behavior 
    in multi-stage graphs (e.g., Changelog).
    """

    def __init__(self, responses: List[Union[str, Exception]]):
        """Initializes the mock provider.

        Args:
            responses (List[Union[str, Exception]]): A list of responses to cycle through.
        """
        self.responses = responses
        self.call_count = 0

    async def invoke_agent(
        self, messages: List[BaseMessage], tools: List[Any], timeout_s: int
    ) -> BaseMessage:
        """Simulates the agent invocation.

        Args:
            messages (List[BaseMessage]): The message history.
            tools (List[Any]): The available tools.
            timeout_s (int): Timeout in seconds.

        Returns:
            BaseMessage: The simulated AI response.

        Raises:
            Exception: If the queued response is an Exception.
        """
        if not self.responses:
            return AIMessage(content='Default response')
            
        resp = self.responses[self.call_count % len(self.responses)]
        self.call_count += 1
        
        if isinstance(resp, Exception):
            raise resp
        return AIMessage(content=resp)
        
    async def complete(self, prompt: str, timeout_s: int) -> str:
        """Simulates a direct completion call.

        Args:
            prompt (str): The prompt text.
            timeout_s (int): Timeout in seconds.

        Returns:
            str: The simulated text response.

        Raises:
            Exception: If the queued response is an Exception.
        """
        if not self.responses:
            return 'Default response'
            
        resp = self.responses[self.call_count % len(self.responses)]
        self.call_count += 1
        
        if isinstance(resp, Exception):
            raise resp
        return str(resp)


class MockGitHubToolset(GitHubToolset):
    """Mock GitHub client with recorded responses for testing MVP tools."""
    
    def __init__(self):
        """Initializes the mock GitHub toolset."""
        self.user_id = 'test_user'
        self.task_id = 'test_task'

    async def read_tree(self, owner: str, repo: str, sha: str) -> dict:
        """Simulates reading the repository tree.

        Args:
            owner (str): The repository owner.
            repo (str): The repository name.
            sha (str): The commit SHA.

        Returns:
            dict: The simulated tree structure.
        """
        return {'nodes': [{'path': 'src/main.ts', 'type': 'file'}]}

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
        return {'content': 'const secret = \'password123\';', 'path': path}

    async def read_issues(
        self, owner: str, repo: str, filter_params: dict = None
    ) -> dict:
        """Simulates reading issues from the repository.

        Args:
            owner (str): The repository owner.
            repo (str): The repository name.
            filter_params (dict, optional): Filtering parameters. Defaults to None.

        Returns:
            dict: The simulated issues.
        """
        # Returns mixed issues to test the quality gate (INCOMPLETE_TASKS)
        return {
            'issues': [
                {
                    'number': 1, 
                    'title': 'Valid issue', 
                    'hasSufficientMetadata': True, 
                    'milestone': 'Sprint 1'
                },
                {
                    'number': 2, 
                    'title': 'Poor issue', 
                    'hasSufficientMetadata': False, 
                    'milestone': 'Sprint 1'
                }
            ]
        }

    async def report_progress(self, stage: str, percent: int) -> None:
        """Simulates reporting progress.

        Args:
            stage (str): The current stage.
            percent (int): The completion percentage.
        """
        pass


@pytest.fixture
def mock_github() -> MockGitHubToolset:
    """Provides a MockGitHubToolset instance.

    Returns:
        MockGitHubToolset: The initialized mock toolset.
    """
    return MockGitHubToolset()


@pytest.fixture
def mvp_context() -> ContextRef:
    """Provides a ContextRef updated to MVP specifications.

    Returns:
        ContextRef: The initialized context reference.
    """
    return ContextRef(
        repoOwner='org',
        repoName='repo',
        repoUrl='https://github.com/org/repo',
        branch='main',
        resolvedSha='abc123def456',
        scopeType='FULL_REPOSITORY'
    )