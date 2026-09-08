"""Shared base functions for agent profiles.

Handles the loading and validation of YAML prompts.
"""

import json
import re
from pathlib import Path

import yaml

from ..config import settings


def load_prompt_template(agent_name: str, template_id: str, version: str = '1.0') -> dict:
    """Loads an isolated YAML prompt from the filesystem.

    Args:
        agent_name (str): The name of the agent.
        template_id (str): The identifier of the template.
        version (str, optional): The template version. Defaults to '1.0'.

    Returns:
        dict: The loaded YAML content as a dictionary.

    Raises:
        FileNotFoundError: If the template file does not exist.
    """
    filename = f'{template_id}.{version}.yaml'
    filepath = Path(settings.prompts_dir) / agent_name / filename

    if not filepath.exists():
        raise FileNotFoundError(f'Template not found: {filepath}')

    with open(filepath, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def render_prompt(template_data: dict, **kwargs) -> tuple[str, str]:
    """Injects variables and separates the system prompt from the user prompt.

    Args:
        template_data (dict): The dictionary containing the template structure.
        **kwargs: Variable keyword arguments to inject into the prompts.

    Returns:
        tuple[str, str]: A tuple containing the system text and the user text.

    Raises:
        ValueError: If a required variable is missing.
    """
    if 'body' in template_data:
        system_text = template_data.get('body', '')
        user_text = 'Proceed with the processing.'
    else:
        system_text = template_data.get('system_prompt', '')
        user_text = template_data.get('user_prompt', '')

    for var in template_data.get('required_vars', []):
        if var not in kwargs:
            raise ValueError(f'Missing required variable for prompt: {var}')

        val = str(kwargs[var])
        system_text = system_text.replace(f'{{{var}}}', val)
        user_text = user_text.replace(f'{{{var}}}', val)

    output_contract = template_data.get('output_contract', '')
    if output_contract:
        system_text = f'{system_text}\n\n[OUTPUT RULES]\n{output_contract}'

    for var in template_data.get('required_vars', []):
        if var not in kwargs:
            raise ValueError(f'Missing required variable for prompt: {var}')

        val = str(kwargs[var])
        system_text = system_text.replace(f'{{{var}}}', val)
        user_text = user_text.replace(f'{{{var}}}', val)

    return system_text, user_text


def extract_json(raw: str) -> dict:
    """Extracts and parses a JSON object from a raw string.

    Args:
        raw (str): The raw text output from the model.

    Returns:
        dict: The parsed JSON object.

    Raises:
        ValueError: If the text cannot be parsed as valid JSON.
    """
    text = raw.strip()

    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        text = match.group(0)

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        # Fallback to handle literal newlines that break JSON parsing
        try:
            clean_text = text.replace('\n', '\\n').replace('\r', '')
            return json.loads(clean_text)
        except Exception:
            raise ValueError(
                f'Unable to parse model response as valid JSON: truncated or malformed.\n'
                f'Error details: {str(e)}'
            )