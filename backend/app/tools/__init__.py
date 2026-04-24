"""Tool library.

Each tool module registers itself at import. Query the registry via
``list_tools()``, ``openai_schemas()``, ``anthropic_schemas()``, and
``schemas_for_scope()``. Execute a tool with ``execute(name, args, folder)``.

Scopes mirror the JSON spec:
- ``"main"``: available to the top-level agent
- ``"sub"``:  available to spawned subagents (a subset)

LLM integration lives elsewhere — this module is transport-agnostic.
"""

from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Set

ToolExecutor = Callable[[Dict[str, Any], Path], Awaitable[str]]


# Tools that need session-level info (Task wants agent_kind/model/api_key;
# AskUserQuestion wants a callback that reaches the UI via WS) read it from
# this ContextVar. The agent loop sets it before each tools.execute() call.
# asyncio.create_task inherits ContextVars, so subagents see the same ctx.
SessionContext = Dict[str, Any]
session_context: ContextVar[SessionContext] = ContextVar(
    "session_context", default={}
)


def set_session_context(ctx: SessionContext) -> None:
    session_context.set(ctx)


def get_session_context() -> SessionContext:
    return session_context.get()


@dataclass
class Tool:
    name: str
    description: str
    input_schema: Dict[str, Any]
    executor: ToolExecutor
    scopes: Set[str] = field(default_factory=lambda: {"main"})


_TOOLS: Dict[str, Tool] = {}


def register(tool: Tool) -> None:
    _TOOLS[tool.name] = tool


def list_tools(scope: str | None = None) -> List[Tool]:
    if scope is None:
        return list(_TOOLS.values())
    return [t for t in _TOOLS.values() if scope in t.scopes]


def _openai_envelope(t: Tool) -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": t.name,
            "description": t.description,
            "parameters": t.input_schema,
        },
    }


def _anthropic_envelope(t: Tool) -> Dict[str, Any]:
    return {
        "name": t.name,
        "description": t.description,
        "input_schema": t.input_schema,
    }


# Gemini's schema validator is stricter than Anthropic's or OpenAI's: it
# rejects a handful of JSON Schema keywords that are harmless to the other
# two. Strip them recursively before submitting tool declarations.
_GEMINI_DROP_KEYS = frozenset({
    "$schema",
    "additionalProperties",
    "default",
    "exclusiveMinimum",
    "exclusiveMaximum",
})


def _sanitize_for_gemini(schema: Any) -> Any:
    if isinstance(schema, dict):
        return {
            k: _sanitize_for_gemini(v)
            for k, v in schema.items()
            if k not in _GEMINI_DROP_KEYS
        }
    if isinstance(schema, list):
        return [_sanitize_for_gemini(v) for v in schema]
    return schema


def _gemini_envelope(t: Tool) -> Dict[str, Any]:
    return {
        "name": t.name,
        "description": t.description,
        "parameters": _sanitize_for_gemini(t.input_schema),
    }


def openai_schemas(scope: str | None = None) -> List[Dict[str, Any]]:
    return [_openai_envelope(t) for t in list_tools(scope)]


def anthropic_schemas(scope: str | None = None) -> List[Dict[str, Any]]:
    return [_anthropic_envelope(t) for t in list_tools(scope)]


def gemini_schemas(scope: str | None = None) -> List[Dict[str, Any]]:
    return [_gemini_envelope(t) for t in list_tools(scope)]


def schemas_for_scope(
    scope: str, style: str = "anthropic"
) -> List[Dict[str, Any]]:
    if style == "openai":
        return openai_schemas(scope)
    if style == "gemini":
        return gemini_schemas(scope)
    return anthropic_schemas(scope)


async def execute(name: str, args: Dict[str, Any], folder: Path) -> str:
    tool = _TOOLS.get(name)
    if tool is None:
        return f"Error: unknown tool '{name}'"
    return await tool.executor(args, folder)


def names(scope: str | None = None) -> List[str]:
    return [t.name for t in list_tools(scope)]


# ----- side-effect registrations -----
# Kept at the bottom to avoid circular imports within tool modules that
# reference ``register`` from this file.

from app.tools import bash  # noqa: E402,F401
from app.tools import glob as _glob  # noqa: E402,F401
from app.tools import grep  # noqa: E402,F401
from app.tools import read  # noqa: E402,F401
from app.tools import edit  # noqa: E402,F401
from app.tools import multi_edit  # noqa: E402,F401
from app.tools import write  # noqa: E402,F401
from app.tools import notebook_edit  # noqa: E402,F401
from app.tools import web  # noqa: E402,F401
from app.tools import todo  # noqa: E402,F401
from app.tools import subagent  # noqa: E402,F401
from app.tools import ask_user  # noqa: E402,F401
from app.tools import plan_mode  # noqa: E402,F401
