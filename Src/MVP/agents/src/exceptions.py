"""Shared exceptions between the graph and individual agents.

Why a separate module: `ReadabilityTooLowError` is raised by the Changelog
agent and caught by the graph, which maps it to
`ErrorKind.READABILITY_TOO_LOW`. Defined inside `agents/changelog.py` — where
it used to be — it created an import cycle: `graph` imported `agents.changelog`
to have the exception, and `agents.changelog` imported `graph` to have
`AgentCancelled` and `resume_action`.

The cycle was not always visible. Starting from `src.graph` (as tests do)
the import passes, because when `changelog` asks for `AgentCancelled` the graph
has already defined it. Starting from `src.main` — i.e. actually starting the
service — it breaks: `main` imports `changelog`, which mid-file imports
`graph`, which turns back to `changelog` for a class not yet declared, and
uvicorn dies with `ImportError: cannot import name 'ReadabilityTooLowError'
from partially initialized module`.

This module imports nothing from the project, so it cannot participate in
any cycle.
"""


class ReadabilityTooLowError(Exception):
    """The produced text does not reach the minimum required readability.

    Mapped to ErrorKind.READABILITY_TOO_LOW by the error handling node.
    """

    def __init__(self, message: str):
        """Initialises the exception.

        Args:
            message (str): The error message.
        """
        self.error_type = "READABILITY_TOO_LOW"
        super().__init__(message)
