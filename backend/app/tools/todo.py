"""Todo tools — TaskCreate / TaskGet / TaskUpdate / TaskList.

Backed by a plain JSON file at ``<folder>/.agent_todos.json``. Scope is
per-folder: two sessions in different folders keep independent todo lists.

Concurrency: each folder gets a dedicated asyncio.Lock so the common
load-modify-save pattern is safe when multiple subagents modify the same
todo list in parallel. File I/O is routed through asyncio.to_thread.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from app.tools import Tool, register

TODO_FILE = ".agent_todos.json"
VALID_STATUSES = {"pending", "in_progress", "completed"}


_folder_locks: Dict[str, asyncio.Lock] = {}


def _lock_for(folder: Path) -> asyncio.Lock:
    key = str(folder)
    lock = _folder_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _folder_locks[key] = lock
    return lock


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_sync(folder: Path) -> Dict[str, Dict[str, Any]]:
    path = folder / TODO_FILE
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(errors="replace"))
    except json.JSONDecodeError:
        return {}


def _save_sync(folder: Path, todos: Dict[str, Dict[str, Any]]) -> None:
    path = folder / TODO_FILE
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(todos, indent=2, ensure_ascii=False))
    tmp.replace(path)  # atomic on POSIX


async def _load(folder: Path) -> Dict[str, Dict[str, Any]]:
    return await asyncio.to_thread(_load_sync, folder)


async def _save(folder: Path, todos: Dict[str, Dict[str, Any]]) -> None:
    await asyncio.to_thread(_save_sync, folder, todos)


def _fmt(t: Dict[str, Any]) -> str:
    blocked = t.get("blockedBy") or []
    blocked_str = f" blockedBy={blocked}" if blocked else ""
    owner = t.get("owner") or ""
    owner_str = f" owner={owner}" if owner else ""
    return f"[{t['id']}] {t['status']:<11} {t['subject']}{owner_str}{blocked_str}"


# ----- TaskCreate -----

async def _task_create(args: Dict[str, Any], folder: Path) -> str:
    subject = args["subject"]
    description = args.get("description", "")
    active_form = args.get("activeForm", "")
    metadata = args.get("metadata") or {}

    async with _lock_for(folder):
        todos = await _load(folder)
        new_id = str(len(todos) + 1)
        while new_id in todos:
            new_id = str(int(new_id) + 1)

        todo = {
            "id": new_id,
            "subject": subject,
            "description": description,
            "activeForm": active_form,
            "status": "pending",
            "owner": "",
            "blocks": [],
            "blockedBy": [],
            "metadata": metadata,
            "created_at": _now(),
            "updated_at": _now(),
        }
        todos[new_id] = todo
        await _save(folder, todos)
    return f"Created task {new_id}: {subject}"


register(Tool(
    name="TaskCreate",
    description=(
        "Create a structured task in the session's todo list.\n\n"
        "Subject should be imperative (e.g. 'Run tests'); activeForm should "
        "be present continuous ('Running tests'). All tasks start as 'pending'."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "subject": {"type": "string", "description": "A brief title"},
            "description": {"type": "string"},
            "activeForm": {
                "type": "string",
                "description": "Present continuous form for in-progress display",
            },
            "metadata": {"type": "object"},
        },
        "required": ["subject", "description"],
    },
    executor=_task_create,
    scopes={"main", "sub"},
))


# ----- TaskGet -----

async def _task_get(args: Dict[str, Any], folder: Path) -> str:
    task_id = str(args["taskId"])
    # Read-only; still take the lock to avoid torn reads during a save.
    async with _lock_for(folder):
        todos = await _load(folder)
    t = todos.get(task_id)
    if t is None:
        return f"Error: no task with id '{task_id}'"
    return json.dumps(t, indent=2)


register(Tool(
    name="TaskGet",
    description="Retrieve a task by its ID from the session's todo list.",
    input_schema={
        "type": "object",
        "properties": {
            "taskId": {"type": "string"},
        },
        "required": ["taskId"],
    },
    executor=_task_get,
    scopes={"main", "sub"},
))


# ----- TaskUpdate -----

async def _task_update(args: Dict[str, Any], folder: Path) -> str:
    task_id = str(args["taskId"])
    async with _lock_for(folder):
        todos = await _load(folder)
        t = todos.get(task_id)
        if t is None:
            return f"Error: no task with id '{task_id}'"

        if "status" in args:
            status = args["status"]
            if status not in VALID_STATUSES:
                return f"Error: status must be one of {sorted(VALID_STATUSES)}"
            t["status"] = status

        for key in ("subject", "description", "activeForm", "owner"):
            if key in args:
                t[key] = args[key]

        if "addBlocks" in args:
            t.setdefault("blocks", []).extend(
                x for x in args["addBlocks"] if x not in t["blocks"]
            )
        if "addBlockedBy" in args:
            t.setdefault("blockedBy", []).extend(
                x for x in args["addBlockedBy"] if x not in t["blockedBy"]
            )

        if "metadata" in args and isinstance(args["metadata"], dict):
            md = t.setdefault("metadata", {})
            for k, v in args["metadata"].items():
                if v is None:
                    md.pop(k, None)
                else:
                    md[k] = v

        t["updated_at"] = _now()
        todos[task_id] = t
        await _save(folder, todos)
    return f"Updated task {task_id}"


register(Tool(
    name="TaskUpdate",
    description=(
        "Update a task in the todo list. Status transitions: pending → "
        "in_progress → completed. Also supports renaming, changing owner, "
        "adding blocks/blockedBy dependencies, and merging metadata (pass "
        "null in metadata values to delete a key)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "taskId": {"type": "string"},
            "subject": {"type": "string"},
            "description": {"type": "string"},
            "activeForm": {"type": "string"},
            "status": {
                "type": "string",
                "enum": list(VALID_STATUSES),
            },
            "addBlocks": {
                "type": "array",
                "items": {"type": "string"},
            },
            "addBlockedBy": {
                "type": "array",
                "items": {"type": "string"},
            },
            "owner": {"type": "string"},
            "metadata": {"type": "object"},
        },
        "required": ["taskId"],
    },
    executor=_task_update,
    scopes={"main", "sub"},
))


# ----- TaskList -----

async def _task_list(args: Dict[str, Any], folder: Path) -> str:
    async with _lock_for(folder):
        todos = await _load(folder)
    if not todos:
        return "(no tasks)"
    lines = [_fmt(t) for t in todos.values()]
    return "\n".join(lines)


register(Tool(
    name="TaskList",
    description=(
        "List all tasks in the session's todo list with id, status, subject, "
        "owner, and blockedBy dependencies. Use TaskGet for full details."
    ),
    input_schema={
        "type": "object",
        "properties": {},
    },
    executor=_task_list,
    scopes={"main", "sub"},
))
