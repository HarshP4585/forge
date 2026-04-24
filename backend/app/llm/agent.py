"""Main agent loop.

Given a user prompt, a conversation history, and runtime context, builds
the provider request, streams the response, executes any tool calls, and
loops until the model returns text with no more tool uses.

The history list is extended IN PLACE so subsequent turns see the full
conversation. It uses our internal Anthropic-shaped format; the OpenAI
provider translates at send time.
"""

import os
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from app import tools as tools_module
from app.llm.context import build as build_context
from app.llm.prompts import (
    MAIN_SYSTEM_PROMPT,
    SYSTEM_REMINDER_PROMPT,
    render,
)
from app.llm.providers import build_provider
from app.tools import set_session_context
from app.tools.policy import is_blocked, needs_approval

EmitFn = Callable[[Dict[str, Any]], Awaitable[None]]

# Per-turn cap on how many tool-use rounds the agent can chain before we
# force-stop. Catches runaway loops without limiting real exploration.
# Override via ``FORGE_MAX_TOOL_ROUNDS`` for tasks like whole-repo audits
# that legitimately need dozens of Read/Grep calls.
def _max_rounds() -> int:
    raw = os.environ.get("FORGE_MAX_TOOL_ROUNDS", "50")
    try:
        return max(1, int(raw))
    except ValueError:
        return 50


MAX_TOOL_ROUNDS = _max_rounds()

# Tools blocked while a session is in plan mode. The model can still
# explore (Read/Grep/Glob/WebSearch) but can't modify state or reach
# out to the network until the user accepts / rejects the plan.
_PLAN_MODE_BLOCKED_TOOLS = frozenset({
    "Bash",
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookEdit",
    "WebFetch",
})

DEFAULT_MODELS = {
    "claude": "claude-sonnet-4-6",
    "openai": "gpt-4o",
    "gemini": "gemini-2.5-flash",
}


def default_model(agent_kind: str) -> str:
    return DEFAULT_MODELS.get(agent_kind, "")


async def run_turn(
    *,
    agent_kind: str,
    model: str,
    api_key: str,
    folder: Path,
    history: List[Dict[str, Any]],
    prompt: str,
    emit: EmitFn,
    is_first_turn: bool,
    attachments: List[Dict[str, Any]] = None,  # type: ignore[assignment]
    ask_user: Any = None,
    approve_tool: Any = None,
    is_tool_auto_approved: Any = None,
    enter_plan_mode: Any = None,
    is_in_plan_mode: Any = None,
) -> None:
    """Execute one user → agent turn. Mutates ``history`` in place."""
    set_session_context({
        "agent_kind": agent_kind,
        "model": model,
        "api_key": api_key,
        "emit": emit,
        "ask_user": ask_user,
        "enter_plan_mode": enter_plan_mode,
    })

    ctx = build_context(folder, agent_kind, model)
    system = render(MAIN_SYSTEM_PROMPT, **ctx)

    # Build the user-message content blocks. For Claude on the first turn,
    # prepend the system-reminder block (with the claudeMd context).
    user_blocks: List[Dict[str, Any]] = []
    if agent_kind == "claude" and is_first_turn:
        user_blocks.append(
            {"type": "text", "text": render(SYSTEM_REMINDER_PROMPT, **ctx)}
        )

    # Attachments: images go as image blocks, text files inlined into the
    # prompt as a code-fenced block with a filename header.
    for att in attachments or []:
        if not isinstance(att, dict):
            continue
        kind = att.get("kind")
        if kind == "image":
            data = att.get("base64") or ""
            mime = att.get("mime") or "image/png"
            if not data:
                continue
            user_blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime,
                    "data": data,
                },
            })
        elif kind == "text":
            name = att.get("name") or "attachment.txt"
            text = att.get("text") or ""
            user_blocks.append({
                "type": "text",
                "text": f"Attached file `{name}`:\n```\n{text}\n```",
            })

    user_blocks.append({"type": "text", "text": prompt})
    history.append({"role": "user", "content": user_blocks})

    # Tool schemas are generated per-vendor from the same registry.
    if agent_kind == "claude":
        tool_schemas = tools_module.anthropic_schemas(scope="main")
    elif agent_kind == "gemini":
        tool_schemas = tools_module.gemini_schemas(scope="main")
    else:
        tool_schemas = tools_module.openai_schemas(scope="main")

    provider = build_provider(agent_kind, api_key)

    try:
        for _ in range(MAX_TOOL_ROUNDS):
            # Before each provider call we've just appended a user-role
            # block to history (either the initial prompt at the top of
            # this function, or a tool_result block at the bottom of the
            # previous iteration). If the provider raises — 429, network
            # blip, cancellation, whatever — that user block is orphaned
            # with no corresponding assistant response, so pop it back off
            # so the next attempt doesn't accumulate ghost messages. Some
            # providers (Gemini) reject consecutive same-role turns; all
            # of them handle this ghost history awkwardly.
            try:
                result = await provider.stream_turn(
                    system=system,
                    messages=history,
                    tools=tool_schemas,
                    model=model,
                    emit=emit,
                )
            except BaseException:
                if history and history[-1].get("role") == "user":
                    history.pop()
                raise

            # Record the assistant message in history (full block list,
            # so Anthropic/OpenAI both see the right shape on next turn).
            assistant_blocks: List[Dict[str, Any]] = []
            if result["text"]:
                assistant_blocks.append({"type": "text", "text": result["text"]})
            for tu in result["tool_uses"]:
                assistant_blocks.append({
                    "type": "tool_use",
                    "id": tu["id"],
                    "name": tu["name"],
                    "input": tu["input"],
                })
            history.append({"role": "assistant", "content": assistant_blocks})

            if not result["tool_uses"]:
                return  # turn complete

            # Execute tools and feed back as tool_result blocks. Before
            # each call, consult the tool policy: "allow" runs free, "ask"
            # pauses for user approval via the runtime, "deny" is a
            # hard-coded no-op (reserved for future policy-file blocks).
            # A denied tool gets a synthetic error tool_result so the
            # model sees the refusal and can course-correct rather than
            # the turn crashing.
            tool_result_blocks: List[Dict[str, Any]] = []
            for tu in result["tool_uses"]:
                await emit({
                    "type": "tool.call.start",
                    "call_id": tu["id"],
                    "tool": tu["name"],
                    "input": tu["input"],
                })

                approved = True
                denied_reason: Optional[str] = None
                if is_blocked(tu["name"]):
                    approved = False
                    denied_reason = (
                        f"Tool '{tu['name']}' is blocked by policy."
                    )
                elif (
                    is_in_plan_mode is not None
                    and is_in_plan_mode()
                    and tu["name"] in _PLAN_MODE_BLOCKED_TOOLS
                ):
                    approved = False
                    denied_reason = (
                        f"Session is in PLAN MODE; '{tu['name']}' is disabled "
                        "until the user accepts or rejects the plan. Use "
                        "read-only tools (Read, Grep, Glob, WebSearch) to "
                        "refine the plan, or wait for the user's decision."
                    )
                elif needs_approval(tu["name"]):
                    already_remembered = bool(
                        is_tool_auto_approved
                        and is_tool_auto_approved(tu["name"])
                    )
                    if not already_remembered and approve_tool is not None:
                        decision = await approve_tool(
                            tu["id"], tu["name"], tu["input"]
                        )
                        approved = bool(decision.get("approved"))
                        if not approved:
                            denied_reason = (
                                "User denied this tool call. Do not retry "
                                "the same call; ask the user what they "
                                "want, or try a different approach."
                            )

                if approved:
                    try:
                        output = await tools_module.execute(
                            tu["name"], tu["input"], folder
                        )
                        is_error = False
                    except Exception as exc:
                        output = f"Tool execution error: {exc}"
                        is_error = True
                else:
                    output = denied_reason or "Tool call not approved."
                    is_error = True

                await emit({
                    "type": "tool.call.result",
                    "call_id": tu["id"],
                    "output": output,
                    "is_error": is_error,
                })
                tool_result_blocks.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": output,
                    "is_error": is_error,
                })
            history.append({"role": "user", "content": tool_result_blocks})

        await emit({
            "type": "system.notice",
            "level": "warn",
            "text": f"Stopped after {MAX_TOOL_ROUNDS} tool rounds (safety cap).",
        })
    finally:
        await provider.close()
