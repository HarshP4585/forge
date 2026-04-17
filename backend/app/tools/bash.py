"""Bash tool — execute a shell command with a timeout."""

import asyncio
from pathlib import Path
from typing import Any, Dict

from app.tools import Tool, register
from app.tools._common import truncate

DEFAULT_TIMEOUT_MS = 120_000
MAX_TIMEOUT_MS = 600_000


async def _bash(args: Dict[str, Any], folder: Path) -> str:
    command = args["command"]
    timeout_ms = int(args.get("timeout") or DEFAULT_TIMEOUT_MS)
    timeout_ms = min(max(timeout_ms, 1), MAX_TIMEOUT_MS)
    timeout_s = timeout_ms / 1000.0

    proc = await asyncio.create_subprocess_shell(
        command,
        cwd=str(folder),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        stdout_bytes, _ = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_s
        )
    except asyncio.TimeoutError:
        proc.kill()
        # Bound the wait after kill — otherwise a stuck child can hang us.
        try:
            await asyncio.wait_for(proc.wait(), timeout=2.0)
        except (asyncio.TimeoutError, Exception):
            pass
        return f"(timed out after {timeout_s}s)"

    output = truncate(stdout_bytes.decode(errors="replace"))
    return f"{output}\n(exit code: {proc.returncode})"


register(Tool(
    name="Bash",
    description=(
        "Executes a given bash command with optional timeout. Working "
        "directory persists between commands; shell state (everything "
        "else) does not.\n\nUsage notes:\n"
        "- Always quote file paths that contain spaces with double quotes\n"
        "- Capture stdout + stderr combined\n"
        "- Timeout is in milliseconds (default 120000, max 600000)\n"
        "- Prefer dedicated tools for file ops (Read/Edit/Write), search "
        "(Glob/Grep), and output (Write) rather than shelling out to "
        "cat/head/tail/find/grep/sed/awk/echo."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "command": {
                "description": "The command to execute",
                "type": "string",
            },
            "timeout": {
                "description": "Optional timeout in milliseconds (max 600000)",
                "type": "number",
            },
            "description": {
                "description": "Clear, concise description of what this command does",
                "type": "string",
            },
            "run_in_background": {
                "description": "Not supported by this tool library yet",
                "type": "boolean",
            },
        },
        "required": ["command"],
    },
    executor=_bash,
    scopes={"main", "sub"},
))
