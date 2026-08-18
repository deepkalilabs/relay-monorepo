#!/usr/bin/env python3

from __future__ import annotations

import asyncio
import atexit
import json
import os
import re
import sys
import threading
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from ast_grep_py import SgRoot
from mcp.server.fastmcp import FastMCP
from solidlsp import SolidLanguageServer
from solidlsp.ls_config import Language, LanguageServerConfig
from solidlsp.settings import SolidLSPSettings


REPOSITORY_ROOT = Path(
    os.environ.get("RALPH_REPO_ROOT", Path.cwd())
).resolve()
STATE_DIRECTORY = Path(
    os.environ.get(
        "RALPH_STATE_DIR", REPOSITORY_ROOT / ".git" / "ralph-loop" / "code-intel"
    )
).resolve()
MCP_PORT = int(os.environ.get("RALPH_MCP_PORT", "8765"))
AST_LANGUAGES = {
    ".cjs": "javascript",
    ".cts": "typescript",
    ".js": "javascript",
    ".jsx": "jsx",
    ".mjs": "javascript",
    ".mts": "typescript",
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "tsx",
}
IGNORED_PATHS = [
    ".git",
    ".next",
    ".venv",
    "coverage",
    "node_modules",
    "playwright-report",
    "test-results",
]
MAX_RESULTS = 100

_language_server: SolidLanguageServer | None = None
_language_server_lock = threading.Lock()
_workspace_anchor: Any | None = None


def _repository_file(input_path: str) -> tuple[Path, str]:
    absolute = (REPOSITORY_ROOT / input_path).resolve()
    try:
        relative = absolute.relative_to(REPOSITORY_ROOT).as_posix()
    except ValueError as error:
        raise ValueError(f"Path must be inside the repository: {input_path}") from error
    if not absolute.is_file():
        raise ValueError(f"File does not exist: {relative}")
    return absolute, relative


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return _json_value(asdict(value))
    if isinstance(value, dict):
        return {
            str(key): _json_value(item)
            for key, item in value.items()
            if key != "parent"
        }
    if isinstance(value, (list, tuple, set)):
        return [_json_value(item) for item in value]
    if hasattr(value, "_asdict"):
        return _json_value(value._asdict())
    if hasattr(value, "__dict__"):
        return _json_value(vars(value))
    return str(value)


def _range_value(node: Any) -> dict[str, dict[str, int]]:
    node_range = node.range()
    return {
        "start": {
            "line": node_range.start.line,
            "column": node_range.start.column,
        },
        "end": {
            "line": node_range.end.line,
            "column": node_range.end.column,
        },
    }


async def _lsp_call(method_name: str, *args: Any) -> Any:
    def invoke() -> Any:
        global _language_server
        with _language_server_lock:
            if _language_server is None or not _language_server.is_running():
                _language_server = _start_language_server()
            return getattr(_language_server, method_name)(*args)

    return _json_value(await asyncio.to_thread(invoke))


def _start_language_server() -> SolidLanguageServer:
    global _workspace_anchor
    STATE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    config = LanguageServerConfig(
        workspace_folders=["."],
        code_language=Language.TYPESCRIPT,
        ignored_paths=IGNORED_PATHS,
    )
    server = SolidLanguageServer.create(
        config,
        str(REPOSITORY_ROOT),
        timeout=120,
        solidlsp_settings=SolidLSPSettings(
            solidlsp_dir=str(STATE_DIRECTORY / "solidlsp"),
            project_data_path=str(STATE_DIRECTORY / "project"),
        ),
    )
    server.start()
    if not server.is_running():
        raise RuntimeError("SolidLSP failed to start the TypeScript language server.")
    anchor = "server.ts"
    if not (REPOSITORY_ROOT / anchor).is_file():
        anchor = next(
            path.relative_to(REPOSITORY_ROOT).as_posix()
            for path in REPOSITORY_ROOT.rglob("*.ts")
            if not any(part in IGNORED_PATHS for part in path.parts)
        )
    _workspace_anchor = server.open_file(anchor)
    _workspace_anchor.__enter__()
    return server


def _stop_language_server() -> None:
    global _language_server, _workspace_anchor
    with _language_server_lock:
        server = _language_server
        _language_server = None
        anchor = _workspace_anchor
        _workspace_anchor = None
        if anchor is not None:
            try:
                anchor.__exit__(None, None, None)
            except Exception:
                pass
        if server is not None and server.is_running():
            server.stop()


mcp = FastMCP(
    "ralph-code-intel",
    instructions=(
        "Read-only structural search and TypeScript language intelligence for the "
        "current repository. Line and column inputs are zero-based."
    ),
    host="127.0.0.1",
    port=MCP_PORT,
    streamable_http_path="/mcp",
)


@mcp.tool()
def ast_pattern_search(
    path: str,
    pattern: str,
    language: str | None = None,
    max_results: int = 50,
) -> list[dict[str, Any]]:
    """Find ast-grep patterns in one repository file without modifying it."""
    absolute, relative = _repository_file(path)
    selected_language = language or AST_LANGUAGES.get(absolute.suffix.lower())
    if selected_language not in set(AST_LANGUAGES.values()):
        raise ValueError(
            "Language must be one of javascript, jsx, python, typescript, or tsx."
        )
    if not 1 <= max_results <= MAX_RESULTS:
        raise ValueError(f"max_results must be between 1 and {MAX_RESULTS}.")

    source = absolute.read_text(encoding="utf-8")
    nodes = SgRoot(source, selected_language).root().find_all(pattern=pattern)
    metavariables = sorted(set(re.findall(r"\$([A-Z][A-Z0-9_]*)", pattern)))
    results: list[dict[str, Any]] = []
    for node in nodes[:max_results]:
        captures: dict[str, Any] = {}
        for metavariable in metavariables:
            captured = node.get_match(metavariable)
            if captured is not None:
                captures[metavariable] = captured.text()
        results.append(
            {
                "path": relative,
                "text": node.text(),
                "range": _range_value(node),
                "metavariables": captures,
            }
        )
    return results


@mcp.tool()
async def lsp_definition(path: str, line: int, column: int) -> Any:
    """Return definitions for a zero-based position in a repository file."""
    _, relative = _repository_file(path)
    return await _lsp_call("request_definition", relative, line, column)


@mcp.tool()
async def lsp_references(path: str, line: int, column: int) -> Any:
    """Return references for a zero-based position in a repository file."""
    _, relative = _repository_file(path)
    return await _lsp_call("request_references", relative, line, column)


@mcp.tool()
async def lsp_hover(path: str, line: int, column: int) -> Any:
    """Return hover information for a zero-based position."""
    _, relative = _repository_file(path)
    return await _lsp_call("request_hover", relative, line, column)


@mcp.tool()
async def lsp_document_symbols(path: str) -> Any:
    """Return the symbol overview for one repository file."""
    _, relative = _repository_file(path)
    return await _lsp_call("request_document_overview", relative)


@mcp.tool()
async def lsp_workspace_symbols(query: str) -> Any:
    """Search TypeScript and JavaScript workspace symbols."""
    return await _lsp_call("request_workspace_symbol", query)


@mcp.tool()
async def lsp_diagnostics(path: str) -> Any:
    """Return all available diagnostics for one repository file."""
    _, relative = _repository_file(path)
    return await _lsp_call(
        "request_text_document_diagnostics", relative, 0, -1, 4
    )


def smoke() -> None:
    root = SgRoot("const result = use(value)", "typescript").root()
    match = root.find(pattern="use($A)")
    if match is None:
        raise RuntimeError("ast-grep smoke pattern did not match.")
    print(
        json.dumps(
            {
                "astMatch": match.get_match("A").text(),
                "solidlspAvailable": SolidLanguageServer is not None,
            }
        )
    )


if __name__ == "__main__":
    if sys.argv[1:] == ["--smoke"]:
        smoke()
    else:
        _language_server = _start_language_server()
        atexit.register(_stop_language_server)
        try:
            mcp.run(transport="streamable-http")
        except KeyboardInterrupt:
            pass
        finally:
            _stop_language_server()
