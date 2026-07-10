"""Agente Docs -- operazione `inline_docs` (UC35).

Prima di interrogare il modello, l'agente individua le unita' di codice prive di
documentazione. Per Python si usa l'AST della libreria standard; per TS/JS un
riconoscimento delle definizioni non precedute da un blocco `/** ... */`.

L'esito e' una PROPOSTA di modifica (diff): nessuna Pull Request viene aperta e
nessun file viene scritto (RS.1).
"""

from __future__ import annotations

import ast
import difflib
import re
from dataclasses import dataclass

from ..errors import ParseError
from ..models import Block, FileChange, FindingBlock, Location, Proposal
from ..ports import AgentProfile, LoadedContext, Prompt
from ._base import extract_json, load_template, render

PY_EXT = (".py",)
JS_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs")

#: Definizioni JS/TS di primo interesse (funzioni, classi, metodi esportati).
_JS_DEF = re.compile(
    r"^(?P<indent>[ \t]*)(?:export\s+)?(?:default\s+)?"
    r"(?:async\s+)?(?:function\s+(?P<fn>\w+)|class\s+(?P<cls>\w+)"
    r"|(?:const|let)\s+(?P<arrow>\w+)\s*=\s*(?:async\s*)?\()"
)


@dataclass(frozen=True)
class Unit:
    """Un'unita' di codice priva di documentazione."""

    file: str
    name: str
    line: int        # 1-based, riga della definizione
    indent: str
    source: str      # estratto di codice mostrato al modello


class DocsInlineProfile(AgentProfile):
    agent = "docs"
    operation = "inline_docs"

    def __init__(self, template: str = "docs_inline", context_lines: int = 12) -> None:
        self._template = template
        self._context_lines = context_lines
        self._units: dict[tuple[str, int], Unit] = {}
        self._sources: dict[str, str] = {}

    # -- composizione del prompt -------------------------------------------

    def build_prompt(self, ctx: LoadedContext) -> Prompt:
        system, user_tpl = load_template(self._template)

        self._sources = dict(ctx.files)
        self._units = {}
        for path, text in ctx.files:
            for u in self.detect_undocumented(path, text):
                self._units[(u.file, u.line)] = u

        if not self._units:
            # Nessuna unita' da documentare: si interroga comunque il modello con
            # un elenco vuoto, che restituira' {"docs": [], "warnings": []}.
            rendered = "(nessuna unita' priva di documentazione)"
        else:
            rendered = "\n\n".join(
                f"### {u.file}:{u.line}  ({u.name})\n```\n{u.source}\n```"
                for u in self._units.values()
            )

        return Prompt(system=system, user=render(user_tpl, units=rendered))

    # -- rilevamento (eseguito PRIMA della chiamata al modello) --------------

    def detect_undocumented(self, path: str, text: str) -> list[Unit]:
        if path.endswith(PY_EXT):
            return self._detect_python(path, text)
        if path.endswith(JS_EXT):
            return self._detect_js(path, text)
        return []

    def _detect_python(self, path: str, text: str) -> list[Unit]:
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return []
        lines = text.splitlines()
        out: list[Unit] = []
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            if ast.get_docstring(node):
                continue
            line = node.lineno
            indent = " " * (node.col_offset)
            # L'AST conosce il confine reale dell'unita': l'estratto non sconfina
            # nella definizione successiva.
            end = min(node.end_lineno or line, line - 1 + self._context_lines)
            out.append(
                Unit(path, node.name, line, indent, "\n".join(lines[line - 1 : end]))
            )
        return sorted(out, key=lambda u: u.line)

    def _detect_js(self, path: str, text: str) -> list[Unit]:
        lines = text.splitlines()
        out: list[Unit] = []
        for i, line in enumerate(lines):
            m = _JS_DEF.match(line)
            if not m:
                continue
            name = m.group("fn") or m.group("cls") or m.group("arrow")
            if not name:
                continue
            if self._has_jsdoc_above(lines, i):
                continue
            out.append(Unit(path, name, i + 1, m.group("indent"), self._excerpt(lines, i + 1)))
        return out

    @staticmethod
    def _has_jsdoc_above(lines: list[str], idx: int) -> bool:
        j = idx - 1
        while j >= 0 and not lines[j].strip():
            j -= 1
        return j >= 0 and lines[j].strip().endswith("*/")

    def _excerpt(self, lines: list[str], line: int) -> str:
        end = min(len(lines), line - 1 + self._context_lines)
        return "\n".join(lines[line - 1 : end])

    # -- validazione e parsing ---------------------------------------------

    def parse_output(self, raw: str) -> tuple[tuple[Block, ...], Proposal | None]:
        data = extract_json(raw)
        if "docs" not in data or not isinstance(data["docs"], list):
            raise ParseError("Chiave 'docs' assente o non valida.")

        # Raggruppa i commenti per file, poi produce un diff per file.
        by_file: dict[str, list[dict]] = {}
        for i, item in enumerate(data["docs"]):
            if not isinstance(item, dict):
                raise ParseError(f"Voce 'docs' #{i} non e' un oggetto.")
            for key in ("file", "line", "doc"):
                if key not in item:
                    raise ParseError(f"Voce 'docs' #{i}: campo '{key}' mancante.")
            path = str(item["file"])
            if self._sources and path not in self._sources:
                raise ParseError(f"Voce 'docs' #{i}: file {path!r} fuori ambito.")
            by_file.setdefault(path, []).append(item)

        changes = tuple(
            FileChange(path=p, unified_diff=self._diff(p, items)) for p, items in sorted(by_file.items())
        )
        proposal = Proposal(kind="inline_doc", files=changes, pr_link=None) if changes else None

        blocks = tuple(self._warning(w, i) for i, w in enumerate(data.get("warnings", []) or []))
        return blocks, proposal

    # -- interni ------------------------------------------------------------

    def _diff(self, path: str, items: list[dict]) -> str:
        original = self._sources.get(path, "")
        lines = original.splitlines(keepends=True)

        # Inserisce dal fondo, cosi' gli indici delle righe precedenti restano validi.
        for item in sorted(items, key=lambda d: int(d["line"]), reverse=True):
            line = int(item["line"])
            if not 1 <= line <= len(lines) + 1:
                raise ParseError(f"{path}: riga {line} fuori intervallo.")
            unit = self._units.get((path, line))
            indent = unit.indent if unit else self._indent_of(lines, line)
            block = self._render_doc(str(item["doc"]), indent, path, line)
            insert_at = line if self._is_python(path) else line - 1
            lines[insert_at:insert_at] = block

        patched = "".join(lines)
        diff = difflib.unified_diff(
            original.splitlines(keepends=True),
            patched.splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            n=3,
        )
        return "".join(diff)

    def _render_doc(self, doc: str, indent: str, path: str, line: int) -> list[str]:
        """Python: docstring DOPO la definizione. JS/TS: blocco JSDoc PRIMA."""
        body = doc.strip().strip('"').strip("'")
        if self._is_python(path):
            inner = indent + "    "
            if "\n" in body:
                rows = [f'{inner}"""{body.splitlines()[0]}\n'] + [
                    f"{inner}{r}\n" for r in body.splitlines()[1:]
                ] + [f'{inner}"""\n']
                return rows
            return [f'{inner}"""{body}"""\n']

        cleaned = [r.strip().lstrip("*").strip() for r in body.splitlines() if r.strip() not in ("/**", "*/")]
        rows = [f"{indent}/**\n"] + [f"{indent} * {r}\n".rstrip() + "\n" for r in cleaned] + [f"{indent} */\n"]
        return rows

    @staticmethod
    def _is_python(path: str) -> bool:
        return path.endswith(PY_EXT)

    @staticmethod
    def _indent_of(lines: list[str], line: int) -> str:
        if 1 <= line <= len(lines):
            raw = lines[line - 1]
            return raw[: len(raw) - len(raw.lstrip())]
        return ""

    @staticmethod
    def _warning(w: object, i: int) -> FindingBlock:
        if not isinstance(w, dict) or "file" not in w:
            raise ParseError(f"Avviso #{i} malformato.")
        line = int(w.get("line", 1) or 1)
        return FindingBlock(
            category="avviso",
            severity="info",
            location=Location(file=str(w["file"]), start_line=line, end_line=line),
            message=str(w.get("message", "Unita' non documentabile in modo affidabile.")),
        )
