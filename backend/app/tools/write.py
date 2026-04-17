"""Write tool — create or overwrite a file."""

import asyncio
from pathlib import Path
from typing import Any, Dict

from app.tools import Tool, register
from app.tools._common import resolve


def _write_sync(args: Dict[str, Any], folder: Path) -> str:
    path = resolve(folder, args["file_path"])
    content = args["content"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return f"Wrote {len(content)} chars to {path}"


async def _write(args: Dict[str, Any], folder: Path) -> str:
    return await asyncio.to_thread(_write_sync, args, folder)


register(Tool(
    name="Write",
    description=(
        "Writes a file to the local filesystem.\n\n"
        "Usage:\n"
        "- Overwrites the existing file if one is present at the path\n"
        "- For existing files, Read them first to understand the content\n"
        "- PREFER editing existing files with Edit over creating new files"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "file_path": {
                "description": "The absolute path to the file to write",
                "type": "string",
            },
            "content": {
                "description": "The content to write to the file",
                "type": "string",
            },
        },
        "required": ["file_path", "content"],
    },
    executor=_write,
    scopes={"main"},
))
