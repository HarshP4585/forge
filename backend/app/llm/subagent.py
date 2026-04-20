"""Subagent runtime — spawn a nested agent loop for `Task` tool.

A subagent:
- Uses a system prompt tied to its ``subagent_type`` (only "Explore" for now).
- Sees a restricted toolset (``scope="sub"``) — no Edit/Write/NotebookEdit/Task.
- Runs its own tool loop identical in shape to the main agent's.
- Hides its internal tool calls from the parent UI (noop emit) — the parent
  only sees the Task tool call starting and its final textual result. This
  matches Claude Code's behaviour and is what makes subagents context-saving.

Background runs are tracked in the module-level ``_RUNS`` dict keyed by
``task_id`` so ``TaskOutput`` and ``TaskStop`` can reach them later.
"""

import asyncio
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Literal, Optional, Tuple

from app import tools as tools_module
from app.llm.context import build as build_context
from app.llm.prompts import SUB_AGENTS_EXPLORE_PROMPT, render
from app.llm.providers import build_provider

EmitFn = Callable[[Dict[str, Any]], Awaitable[None]]

MAX_SUBAGENT_ROUNDS = 30

SUBAGENT_PROMPTS: Dict[str, str] = {
    "Explore": SUB_AGENTS_EXPLORE_PROMPT,
}


SubagentStatus = Literal["running", "completed", "cancelled", "error"]


@dataclass
class SubagentRun:
    task_id: str
    subagent_type: str
    description: str
    prompt: str
    status: SubagentStatus = "running"
    output: str = ""
    error: Optional[str] = None
    task: Optional[asyncio.Task] = None


_RUNS: Dict[str, SubagentRun] = {}


async def _noop_emit(_event: Dict[str, Any]) -> None:
    # Subagent's internal tool calls are NOT shown in the parent UI.
    pass


async def _execute(
    run: SubagentRun,
    folder: Path,
    agent_kind: str,
    model: str,
    api_key: str,
) -> None:
    system_template = SUBAGENT_PROMPTS.get(run.subagent_type)
    if system_template is None:
        run.status = "error"
        run.error = f"Unknown subagent_type: {run.subagent_type}"
        run.output = run.error
        return

    ctx = build_context(folder, agent_kind, model)
    system = render(system_template, **ctx)
    if agent_kind == "claude":
        tool_schemas = tools_module.anthropic_schemas(scope="sub")
    elif agent_kind == "gemini":
        tool_schemas = tools_module.gemini_schemas(scope="sub")
    else:
        tool_schemas = tools_module.openai_schemas(scope="sub")
    history: List[Dict[str, Any]] = [
        {"role": "user", "content": [{"type": "text", "text": run.prompt}]}
    ]
    provider = build_provider(agent_kind, api_key)
    final_text = ""

    try:
        for _ in range(MAX_SUBAGENT_ROUNDS):
            result = await provider.stream_turn(
                system=system,
                messages=history,
                tools=tool_schemas,
                model=model,
                emit=_noop_emit,
            )
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
                final_text = result["text"]
                break

            tool_result_blocks: List[Dict[str, Any]] = []
            for tu in result["tool_uses"]:
                try:
                    output = await tools_module.execute(
                        tu["name"], tu["input"], folder
                    )
                    is_error = False
                except Exception as exc:
                    output = f"Tool execution error: {exc}"
                    is_error = True
                tool_result_blocks.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": output,
                    "is_error": is_error,
                })
            history.append({"role": "user", "content": tool_result_blocks})

        run.output = final_text or "(subagent produced no output)"
        run.status = "completed"
    except asyncio.CancelledError:
        run.status = "cancelled"
        run.output = final_text or "(cancelled before completion)"
        raise
    except Exception as exc:
        run.status = "error"
        run.error = str(exc)
        run.output = f"Error: {exc}"
    finally:
        await provider.close()


async def spawn(
    *,
    subagent_type: str,
    description: str,
    prompt: str,
    folder: Path,
    agent_kind: str,
    model: str,
    api_key: str,
    run_in_background: bool = False,
) -> Tuple[str, Optional[str], SubagentStatus]:
    """Spawn a subagent. Returns (task_id, output_if_blocking, status).

    - blocking: awaits completion, ``output`` is the final text
    - background: returns immediately with ``output=None``; poll via
      ``get_run()`` or the ``TaskOutput`` tool
    """
    task_id = f"task-{uuid.uuid4()}"
    run = SubagentRun(
        task_id=task_id,
        subagent_type=subagent_type,
        description=description,
        prompt=prompt,
    )
    _RUNS[task_id] = run
    run.task = asyncio.create_task(
        _execute(run, folder, agent_kind, model, api_key)
    )

    if run_in_background:
        return (task_id, None, run.status)

    try:
        await run.task
    except asyncio.CancelledError:
        pass
    return (task_id, run.output, run.status)


def get_run(task_id: str) -> Optional[SubagentRun]:
    return _RUNS.get(task_id)


async def stop(task_id: str) -> bool:
    run = _RUNS.get(task_id)
    if run is None or run.task is None or run.task.done():
        return False
    run.task.cancel()
    try:
        await run.task
    except BaseException:
        pass
    return True


async def wait_for(task_id: str, timeout_s: float) -> Optional[SubagentRun]:
    run = _RUNS.get(task_id)
    if run is None:
        return None
    if run.task and not run.task.done():
        try:
            await asyncio.wait_for(asyncio.shield(run.task), timeout=timeout_s)
        except asyncio.TimeoutError:
            pass
        except BaseException:
            pass
    return run
