"""Read tool — read a file with optional offset/limit, cat -n style output.

Streams line-by-line rather than loading the whole file. Files bigger than
MAX_READ_FILE_SIZE are rejected. Binary files are rejected. .ipynb is
special-cased. All I/O happens in a worker thread so parallel subagent
reads don't serialize behind each other.
"""

import asyncio
import json
from pathlib import Path
from typing import Any, Dict

from app.tools import Tool, register
from app.tools._common import MAX_READ_FILE_SIZE, is_binary, resolve

DEFAULT_LIMIT = 2000
MAX_LINE_CHARS = 2000


def _read_sync(args: Dict[str, Any], folder: Path) -> str:
    path = resolve(folder, args["file_path"])
    offset = int(args.get("offset") or 0)
    limit = int(args.get("limit") or DEFAULT_LIMIT)

    if not path.exists():
        return f"Error: file not found: {path}"
    if not path.is_file():
        return f"Error: not a file: {path}"

    if path.suffix == ".ipynb":
        try:
            nb = json.loads(path.read_text(errors="replace"))
        except json.JSONDecodeError as exc:
            return f"Error: invalid notebook JSON: {exc}"
        parts = []
        for i, cell in enumerate(nb.get("cells", [])):
            src = cell.get("source", "")
            if isinstance(src, list):
                src = "".join(src)
            ctype = cell.get("cell_type", "code")
            parts.append(f"# --- cell [{i}] ({ctype}) ---\n{src}")
        return "\n\n".join(parts) if parts else "(empty notebook)"

    try:
        size = path.stat().st_size
    except OSError as exc:
        return f"Error: {exc}"
    if size > MAX_READ_FILE_SIZE:
        return (
            f"Error: file too large ({size} bytes > {MAX_READ_FILE_SIZE}). "
            "Use Bash with head/tail or read specific ranges instead."
        )
    if is_binary(path):
        return f"Error: {path} appears to be a binary file"

    out: list[str] = []
    stop_at = offset + limit
    try:
        with path.open("r", errors="replace") as fh:
            for i, line in enumerate(fh):
                if i < offset:
                    continue
                if i >= stop_at:
                    break
                line = line.rstrip("\n")
                if len(line) > MAX_LINE_CHARS:
                    line = line[:MAX_LINE_CHARS] + "… (truncated)"
                out.append(f"{i + 1:>6}\t{line}")
    except OSError as exc:
        return f"Error: {exc}"

    if not out:
        return "(empty or out of range)"
    return "\n".join(out)


async def _read(args: Dict[str, Any], folder: Path) -> str:
    return await asyncio.to_thread(_read_sync, args, folder)


register(Tool(
    name="Read",
    description=(
        "Reads a file from the local filesystem.\n\n"
        "Usage:\n"
        "- The file_path parameter must be an absolute path (relative paths "
        "resolve against the session folder)\n"
        "- By default reads up to 2000 lines from the top\n"
        "- Optional offset (starting line, 0-indexed) and limit for large files\n"
        "- Lines longer than 2000 chars are truncated\n"
        "- Returns cat -n style output (line number + tab + content)\n"
        "- Jupyter notebooks (.ipynb) are flattened into labelled cells\n"
        "- Files larger than 10MB or detected as binary are rejected"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "file_path": {
                "description": "The absolute path to the file to read",
                "type": "string",
            },
            "offset": {
                "description": "The line number (0-indexed) to start reading from",
                "type": "number",
            },
            "limit": {
                "description": "The number of lines to read (default 2000)",
                "type": "number",
            },
        },
        "required": ["file_path"],
    },
    executor=_read,
    scopes={"main", "sub"},
))
