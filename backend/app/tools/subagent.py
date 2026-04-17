"""Task / TaskStop / TaskOutput tools — spawn and control subagents.

The actual subagent execution lives in ``app.llm.subagent``; these tools
are thin wrappers that read session context (agent_kind, model, api_key)
from the harness ContextVar and dispatch.
"""

from pathlib import Path
from typing import Any, Dict

from app.llm import subagent as sub
from app.tools import Tool, get_session_context, register

VALID_SUBAGENT_TYPES = list(sub.SUBAGENT_PROMPTS.keys())


async def _task(args: Dict[str, Any], folder: Path) -> str:
    ctx = get_session_context()
    agent_kind = ctx.get("agent_kind")
    model = ctx.get("model")
    api_key = ctx.get("api_key")
    if not (agent_kind and model and api_key):
        return (
            "Error: Task requires session context (agent_kind/model/api_key). "
            "Called from outside a managed session."
        )

    subagent_type = args.get("subagent_type")
    if subagent_type not in sub.SUBAGENT_PROMPTS:
        return (
            f"Error: unsupported subagent_type '{subagent_type}'. "
            f"Supported: {', '.join(VALID_SUBAGENT_TYPES)}"
        )

    prompt = args.get("prompt") or ""
    description = args.get("description") or ""
    run_in_background = bool(args.get("run_in_background", False))
    override_model = args.get("model")

    task_id, output, status = await sub.spawn(
        subagent_type=subagent_type,
        description=description,
        prompt=prompt,
        folder=folder,
        agent_kind=agent_kind,
        model=override_model or model,
        api_key=api_key,
        run_in_background=run_in_background,
    )

    if run_in_background:
        return f"Launched subagent in background. task_id={task_id}"
    return (
        f"[task_id={task_id}, status={status}]\n"
        f"{output or '(empty)'}"
    )


async def _task_stop(args: Dict[str, Any], _folder: Path) -> str:
    task_id = args.get("task_id") or args.get("shell_id")
    if not task_id:
        return "Error: task_id required"
    ok = await sub.stop(task_id)
    return f"Stopped task {task_id}" if ok else f"Task {task_id} was not running"


async def _task_output(args: Dict[str, Any], _folder: Path) -> str:
    task_id = args.get("task_id")
    if not task_id:
        return "Error: task_id required"
    block = args.get("block", True)
    timeout_ms = int(args.get("timeout") or 30000)
    if block:
        run = await sub.wait_for(task_id, timeout_s=timeout_ms / 1000.0)
    else:
        run = sub.get_run(task_id)
    if run is None:
        return f"Error: no task with id {task_id}"
    return f"[status={run.status}]\n{run.output}"


register(Tool(
    name="Task",
    description=(
        "Launch a subagent to handle exploration or multi-step research "
        "autonomously. Subagents see a restricted toolset (read/search only) "
        "and their internal tool calls do NOT pollute the parent conversation. "
        "Use this for open-ended codebase exploration — the subagent returns a "
        "concise final report.\n\n"
        f"Available subagent types: {', '.join(VALID_SUBAGENT_TYPES)}"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": "A short (3-5 word) description of the task",
            },
            "prompt": {
                "type": "string",
                "description": "The task for the subagent to perform",
            },
            "subagent_type": {
                "type": "string",
                "description": "Which subagent to use",
                "enum": VALID_SUBAGENT_TYPES,
            },
            "model": {
                "type": "string",
                "description": "Optional model override. Defaults to parent's model.",
            },
            "run_in_background": {
                "type": "boolean",
                "description": (
                    "Return a task_id immediately instead of blocking. "
                    "Poll with TaskOutput."
                ),
            },
        },
        "required": ["description", "prompt", "subagent_type"],
    },
    executor=_task,
    scopes={"main"},
))


register(Tool(
    name="TaskStop",
    description="Stop a running background subagent by its task_id.",
    input_schema={
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "The task ID to stop",
            },
        },
        "required": ["task_id"],
    },
    executor=_task_stop,
    scopes={"main"},
))


register(Tool(
    name="TaskOutput",
    description=(
        "Retrieve the output (partial or final) of a subagent by task_id. "
        "Use block=true (default) to wait for completion, false for an "
        "immediate snapshot."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "block": {
                "type": "boolean",
                "description": "Whether to wait for completion (default true)",
            },
            "timeout": {
                "type": "number",
                "description": "Max wait in ms (default 30000, max 600000)",
            },
        },
        "required": ["task_id"],
    },
    executor=_task_output,
    scopes={"main"},
))
