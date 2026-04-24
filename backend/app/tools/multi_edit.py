"""MultiEdit tool — apply a batch of string replacements atomically.

Reads the file once, applies every edit in order against the evolving
in-memory buffer, and writes once at the end. If any edit's match rule
fails (not found, or non-unique without ``replace_all``), the whole
batch aborts and the on-disk file is untouched. That's the Claude Code
contract — callers can rely on all-or-nothing semantics.
"""

import asyncio
from pathlib import Path
from typing import Any, Dict, List

from app.tools import Tool, register
from app.tools._common import resolve


def _apply_edits(buffer: str, edits: List[Dict[str, Any]]) -> tuple[str, List[str]]:
    """Run the edits sequentially against ``buffer``; return the new
    buffer plus a per-edit summary. Raises ``ValueError`` on any match
    failure so the caller can bail without writing."""
    summaries: List[str] = []
    for i, edit in enumerate(edits, 1):
        if not isinstance(edit, dict):
            raise ValueError(f"edit #{i}: must be an object")
        old = edit.get("old_string")
        new = edit.get("new_string")
        replace_all = bool(edit.get("replace_all"))
        if not isinstance(old, str) or not isinstance(new, str):
            raise ValueError(f"edit #{i}: old_string and new_string are required")
        if old == new:
            raise ValueError(f"edit #{i}: old_string and new_string must differ")
        count = buffer.count(old)
        if count == 0:
            raise ValueError(f"edit #{i}: old_string not found")
        if count > 1 and not replace_all:
            raise ValueError(
                f"edit #{i}: old_string appears {count} times; "
                "add surrounding context to make it unique, or pass replace_all=true"
            )
        if replace_all:
            buffer = buffer.replace(old, new)
            summaries.append(f"edit #{i}: replaced {count} occurrence(s)")
        else:
            buffer = buffer.replace(old, new, 1)
            summaries.append(f"edit #{i}: replaced 1 occurrence")
    return buffer, summaries


def _multi_edit_sync(args: Dict[str, Any], folder: Path) -> str:
    path = resolve(folder, args["file_path"])
    edits = args.get("edits")
    if not isinstance(edits, list) or not edits:
        return "Error: 'edits' must be a non-empty array"
    if not path.exists():
        return f"Error: file not found: {path}"
    if not path.is_file():
        return f"Error: not a file: {path}"

    try:
        text = path.read_text(errors="replace")
    except (OSError, PermissionError) as exc:
        return f"Error: {exc}"

    try:
        new_text, summaries = _apply_edits(text, edits)
    except ValueError as exc:
        # File is untouched — that's the atomicity guarantee.
        return f"Error: {exc}. No changes written."

    if new_text == text:
        return f"No changes to {path} (every edit was a no-op)"

    try:
        path.write_text(new_text)
    except (OSError, PermissionError) as exc:
        return f"Error writing {path}: {exc}"

    return f"Applied {len(edits)} edit(s) to {path}:\n" + "\n".join(
        f"  {s}" for s in summaries
    )


async def _multi_edit(args: Dict[str, Any], folder: Path) -> str:
    return await asyncio.to_thread(_multi_edit_sync, args, folder)


register(Tool(
    name="MultiEdit",
    description=(
        "Apply multiple exact string replacements to a single file in one "
        "atomic operation. Edits are applied in order against the evolving "
        "buffer, so later edits see the output of earlier ones. If any "
        "edit's match rule fails (not found, or non-unique without "
        "`replace_all`), the ENTIRE batch is aborted and the file is left "
        "untouched.\n\n"
        "Prefer MultiEdit over several back-to-back Edit calls when changing "
        "the same file: it's atomic, cheaper in tokens, and surfaces "
        "conflicts (e.g. a later edit's `old_string` no longer matching "
        "because an earlier edit rewrote that region) before anything "
        "lands on disk.\n\n"
        "Usage:\n"
        "- Read the file first to confirm `old_string` values are unique "
        "  (strongly recommended)\n"
        "- Preserve exact indentation / whitespace in `old_string`\n"
        "- Each edit's `replace_all` defaults to false — set it to true "
        "  to change every occurrence of that specific `old_string`"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "The absolute path to the file to modify",
            },
            "edits": {
                "type": "array",
                "minItems": 1,
                "description": "Ordered list of string replacements",
                "items": {
                    "type": "object",
                    "properties": {
                        "old_string": {
                            "type": "string",
                            "description": "The text to replace",
                        },
                        "new_string": {
                            "type": "string",
                            "description": "The replacement text",
                        },
                        "replace_all": {
                            "type": "boolean",
                            "description": "Replace every occurrence (default false)",
                            "default": False,
                        },
                    },
                    "required": ["old_string", "new_string"],
                },
            },
        },
        "required": ["file_path", "edits"],
    },
    executor=_multi_edit,
    scopes={"main"},
))
