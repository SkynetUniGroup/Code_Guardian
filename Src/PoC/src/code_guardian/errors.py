"""Errori tipizzati. Ognuno mappa 1:1 su un `ErrorInfo.type` del Report."""

from __future__ import annotations


class AgentError(Exception):
    """Base. Ogni sottoclasse dichiara il proprio `error_type`."""

    error_type: str = "parse"


class TimeoutErr(AgentError):
    """Il modello non ha risposto entro il limite (RQ.7: 45 s)."""

    error_type = "timeout"


class ParseError(AgentError):
    """L'esito del modello non e' interpretabile secondo lo schema atteso."""

    error_type = "parse"


class ContextMissing(AgentError):
    """Il contesto richiesto non esiste o e' vuoto."""

    error_type = "context_missing"
