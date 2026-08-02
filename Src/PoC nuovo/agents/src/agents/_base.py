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

def render_prompt(template_data: dict, **kwargs) -> tuple[str, str]:
    """Inietta le variabili e separa il prompt di sistema da quello utente."""
    
    # Retrocompatibilità col vecchio formato 'body'
    if "body" in template_data:
        system_text = template_data.get("body", "")
        user_text = "Procedi con l'elaborazione."
    else:
        system_text = template_data.get("system_prompt", "")
        user_text = template_data.get("user_prompt", "")
    
    # Validazione e iniezione delle variabili richieste in ENTRAMBI i blocchi
    for var in template_data.get("required_vars", []):
        if var not in kwargs:
            raise ValueError(f"Variabile obbligatoria mancante per il prompt: {var}")
        
        val = str(kwargs[var])
        system_text = system_text.replace(f"{{{var}}}", val)
        user_text = user_text.replace(f"{{{var}}}", val)
        
    output_contract = template_data.get("output_contract", "")
    
    # Accodiamo il contratto di output rigidamente al SYSTEM prompt
    if output_contract:
        system_text = f"{system_text}\n\n[REGOLE DI OUTPUT]\n{output_contract}"
        
    return system_text, user_text

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