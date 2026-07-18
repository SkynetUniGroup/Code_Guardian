"""Base condivisa dai tre `AgentProfile`.

Contiene solo cio' che e' comune: il caricamento del template esterno e
l'estrazione robusta del JSON dalla risposta del modello. La logica specifica
resta nei tre moduli figli.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from ..errors import ParseError
from ..ports import Prompt

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

_SYS_RE = re.compile(r"^\s*\[SYSTEM\]\s*$", re.MULTILINE)
_USR_RE = re.compile(r"^\s*\[USER\]\s*$", re.MULTILINE)
_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.MULTILINE)


@lru_cache(maxsize=None)
def load_template(name: str) -> tuple[str, str]:
    """Carica `prompts/<name>.md` e ne restituisce le sezioni (system, user).

    I prompt vivono in file esterni e versionati: nessuna istruzione al modello
    e' incorporata nel codice applicativo (RQ.8).
    """
    path = PROMPTS_DIR / f"{name}.md"
    if not path.is_file():
        raise FileNotFoundError(f"Template di prompt mancante: {path}")
    text = path.read_text(encoding="utf-8")

    sys_m, usr_m = _SYS_RE.search(text), _USR_RE.search(text)
    if not sys_m or not usr_m or usr_m.start() < sys_m.end():
        raise ValueError(f"Template malformato (attesi [SYSTEM] e [USER]): {path}")

    system = text[sys_m.end() : usr_m.start()].strip()
    user = text[usr_m.end() :].strip()
    return system, user


def render(template: str, **vars_: str) -> str:
    """Sostituzione dei segnaposto `{{nome}}`."""
    out = template
    for k, v in vars_.items():
        out = out.replace("{{" + k + "}}", v)
    return out


def extract_json(raw: str) -> dict:
    """Estrae l'oggetto JSON dalla risposta, tollerando i recinti Markdown.

    Solleva ParseError: l'esito non interpretabile e' una condizione d'errore
    prevista (UC27.3), non un'eccezione da propagare.
    """
    if not raw or not raw.strip():
        raise ParseError("Il modello ha restituito una risposta vuota.")

    cleaned = _FENCE_RE.sub("", raw).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        raise ParseError("Nessun oggetto JSON individuabile nella risposta.")

    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ParseError(f"JSON non valido: {exc.msg} (pos. {exc.pos})") from exc

    if not isinstance(data, dict):
        raise ParseError("La risposta non e' un oggetto JSON.")
    return data


def number_lines(text: str, start: int = 1) -> str:
    """Antepone il numero di riga, cosi' il modello puo' citarle correttamente."""
    return "\n".join(f"{i:>4} | {ln}" for i, ln in enumerate(text.splitlines(), start))
