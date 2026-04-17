"""Glob tool — fast file pattern matching, sorted by mtime (desc)."""

import asyncio
from pathlib import Path
from typing import Any, Dict, List, Tuple

from app.tools import Tool, register
from app.tools._common import resolve, truncate


def _glob_sync(args: Dict[str, Any], folder: Path) -> str:
    pattern = args["pattern"]
    base = resolve(folder, args["path"]) if args.get("path") else folder
    if not base.is_dir():
        return f"Error: not a directory: {base}"

    # Compute mtime ONCE per path. Sorting with a key lambda that calls
    # stat() would re-stat on every comparison.
    entries: List[Tuple[float, Path]] = []
    for p in base.glob(pattern):
        try:
            mtime = p.stat().st_mtime
        except OSError:
            mtime = 0.0
        entries.append((mtime, p))
    entries.sort(key=lambda x: x[0], reverse=True)

    lines = [str(p) for _, p in entries]
    if not lines:
        return "(no matches)"
    return truncate("\n".join(lines))


async def _glob(args: Dict[str, Any], folder: Path) -> str:
    # Directory scans + stat() block the event loop; offload to a thread so
    # parallel subagent tool calls don't serialize behind each other.
    return await asyncio.to_thread(_glob_sync, args, folder)


register(Tool(
    name="Glob",
    description=(
        "- Fast file pattern matching tool that works with any codebase size\n"
        "- Supports glob patterns like \"**/*.js\" or \"src/**/*.ts\"\n"
        "- Returns matching file paths sorted by modification time (newest first)\n"
        "- Use this tool when you need to find files by name patterns\n"
        "- For open-ended multi-round searches, prefer an Explore / Task agent"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "pattern": {
                "description": "The glob pattern to match files against",
                "type": "string",
            },
            "path": {
                "description": (
                    "The directory to search in. If not specified, the "
                    "session's working directory is used. Omit this field "
                    "to use the default — do not pass 'undefined' or 'null'."
                ),
                "type": "string",
            },
        },
        "required": ["pattern"],
    },
    executor=_glob,
    scopes={"main", "sub"},
))
