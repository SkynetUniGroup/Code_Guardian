"""Funzioni di base condivise dai profili degli agenti.
Gestisce il caricamento e la validazione dei prompt YAML (Appendice D).
"""

import yaml
from pathlib import Path
from ..config import settings

def load_prompt_template(agent_name: str, template_id: str, version: str = "1.0") -> dict:
    """Carica un prompt YAML isolato dal filesystem."""
    filename = f"{template_id}.{version}.yaml"
    filepath = Path(settings.prompts_dir) / agent_name / filename
    
    if not filepath.exists():
        raise FileNotFoundError(f"Template non trovato: {filepath}")
        
    with open(filepath, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def render_prompt(template_data: dict, **kwargs) -> str:
    """Inietta le variabili nel corpo e accoda il contratto di output."""
    body = template_data.get("body", "")
    
    # Validazione e iniezione delle variabili richieste
    for var in template_data.get("required_vars", []):
        if var not in kwargs:
            raise ValueError(f"Variabile obbligatoria mancante per il prompt: {var}")
        body = body.replace(f"{{{var}}}", str(kwargs[var]))
        
    output_contract = template_data.get("output_contract", "")
    
    # Restituiamo il prompt completo pronto per il modello LLM
    return f"{body}\n\n[REGOLE DI OUTPUT]\n{output_contract}"

def extract_json(raw: str) -> dict:
    """Estrae un oggetto JSON pulito da una stringa prodotta da un LLM."""
    import json
    text = raw.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return json.loads(text.strip())