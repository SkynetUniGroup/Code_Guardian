from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from ..config import settings


def load_prompt_template(agent_name: str, template_id: str, version: str = "1.0") -> dict:
    filename = f"{template_id}.{version}.yaml"
    filepath = Path(settings.prompts_dir) / agent_name / filename

    if not filepath.exists():
        raise FileNotFoundError(f"Template non trovato: {filepath}")

    with open(filepath, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def render_prompt(template_data: dict, **kwargs) -> tuple[str, str]:
    if "body" in template_data:
        system_text = template_data.get("body", "")
        user_text = "Procedi con l'elaborazione."
    else:
        system_text = template_data.get("system_prompt", "")
        user_text = template_data.get("user_prompt", "")

    for var in template_data.get("required_vars", []):
        if var not in kwargs:
            raise ValueError(f"Variabile obbligatoria mancante: {var}")
        val = str(kwargs[var])
        system_text = system_text.replace(f"{{{var}}}", val)
        user_text = user_text.replace(f"{{{var}}}", val)

    output_contract = template_data.get("output_contract", "")
    if output_contract:
        system_text = f"{system_text}\n\n[REGOLE DI OUTPUT]\n{output_contract}"

    return system_text, user_text


def extract_json(raw: str) -> dict:
    text = raw.strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        try:
            clean = text.replace("\n", "\\n").replace("\r", "")
            if not clean.endswith("}"):
                clean += '"}]}'
            return json.loads(clean)
        except Exception:
            raise ValueError(
                f"Impossibile interpretare la risposta come JSON valido. Dettaglio: {exc}"
            )
