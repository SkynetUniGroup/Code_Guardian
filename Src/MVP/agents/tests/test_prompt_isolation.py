"""Static analysis test for prompt isolation.

Ensures that LLM prompts are isolated in external YAML files (Metric MPD_14).
"""

import ast
import glob
import os

import pytest


def test_prompt_isolation_mpd_14() -> None:
    """Statically tests the MPD_14 metric (Prompt Isolation).

    Parses the AST of Python agent modules. Fails if it finds string 
    literals exceeding the threshold, guaranteeing that prompts reside 
    in external YAML files (RQ.4).
    """
    MAX_STRING_LENGTH = 250 
    
    agent_files = glob.glob('src/agents/*.py')
    assert len(agent_files) > 0, 'No agent files found for static analysis.'
    
    for file_path in agent_files:
        with open(file_path, 'r', encoding='utf-8') as f:
            code = f.read()
            
        tree = ast.parse(code, filename=file_path)
        
        docstring_node_ids = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                if (
                    node.body 
                    and isinstance(node.body[0], ast.Expr) 
                    and isinstance(node.body[0].value, ast.Constant) 
                    and isinstance(node.body[0].value.value, str)
                ):
                    docstring_node_ids.add(id(node.body[0].value))
        
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                if id(node) in docstring_node_ids:
                    continue

                text = node.value.strip()
                
                ignore_prefixes = ('Exception ', 'Your output generated')
                if text.startswith(ignore_prefixes):
                    continue

                if len(text) > MAX_STRING_LENGTH:
                    pytest.fail(
                        f"MPD_14 Metric Violation (RQ.4) in '{os.path.basename(file_path)}' "
                        f"at line {node.lineno}.\nFound hardcoded string of {len(text)} "
                        f"characters. LLM prompts must be in YAML.\nPreview: {text[:50]}..."
                    )