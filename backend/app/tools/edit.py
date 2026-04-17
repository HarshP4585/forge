"""Edit tool — exact string replacement in a file."""

import asyncio
from pathlib import Path
from typing import Any, Dict

from app.tools import Tool, register
from app.tools._common import resolve


def _edit_sync(args: Dict[str, Any], folder: Path) -> str:
    path = resolve(folder, args["file_path"])
    old = args["old_string"]
    new = args["new_string"]
    replace_all = bool(args.get("replace_all"))

    if old == new:
        return "Error: old_string and new_string must differ"
    if not path.exists():
        return f"Error: file not found: {path}"
    if not path.is_file():
        return f"Error: not a file: {path}"

    try:
        text = path.read_text(errors="replace")
    except (OSError, PermissionError) as exc:
        return f"Error: {exc}"

    if replace_all:
        count = text.count(old)
        if count == 0:
            return f"Error: old_string not found in {path}"
        path.write_text(text.replace(old, new))
        return f"Replaced {count} occurrence(s) in {path}"

    count = text.count(old)
    if count == 0:
        return f"Error: old_string not found in {path}"
    if count > 1:
        return (
            f"Error: old_string appears {count} times in {path}; "
            "add surrounding context to make it unique, or pass replace_all=true"
        )
    path.write_text(text.replace(old, new, 1))
    return f"Edited {path}"


async def _edit(args: Dict[str, Any], folder: Path) -> str:
    return await asyncio.to_thread(_edit_sync, args, folder)


register(Tool(
    name="Edit",
    description=(
        "Performs exact string replacements in files.\n\n"
        "Usage:\n"
        "- Use your Read tool at least once before editing (strongly recommended)\n"
        "- Preserve exact indentation from the file\n"
        "- The edit FAILS if old_string is not unique in the file — provide "
        "more surrounding context or use replace_all to change every instance"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "file_path": {
                "description": "The absolute path to the file to modify",
                "type": "string",
            },
            "old_string": {
                "description": "The text to replace",
                "type": "string",
            },
            "new_string": {
                "description": "The text to replace it with (must be different)",
                "type": "string",
            },
            "replace_all": {
                "description": "Replace all occurrences of old_string (default false)",
                "type": "boolean",
                "default": False,
            },
        },
        "required": ["file_path", "old_string", "new_string"],
    },
    executor=_edit,
    scopes={"main"},
))
