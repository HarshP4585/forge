"""NotebookEdit tool — replace/insert/delete a cell in a .ipynb file."""

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any, Dict

from app.tools import Tool, register
from app.tools._common import resolve


def _split_source(source: str) -> list[str]:
    """Jupyter stores source as a list of lines (with trailing \\n)."""
    lines = source.splitlines(keepends=True)
    return lines if lines else [source]


def _notebook_edit_sync(args: Dict[str, Any], folder: Path) -> str:
    path = resolve(folder, args["notebook_path"])
    new_source = args.get("new_source", "")
    cell_id = args.get("cell_id")
    cell_type = args.get("cell_type")
    edit_mode = args.get("edit_mode", "replace")

    if not path.exists():
        return f"Error: notebook not found: {path}"
    if path.suffix != ".ipynb":
        return f"Error: not a .ipynb file: {path}"

    try:
        nb = json.loads(path.read_text(errors="replace"))
    except json.JSONDecodeError as exc:
        return f"Error: invalid notebook JSON: {exc}"

    cells = nb.get("cells", [])

    target_idx = None
    if cell_id is not None:
        for i, cell in enumerate(cells):
            if cell.get("id") == cell_id:
                target_idx = i
                break

    if edit_mode == "replace":
        if target_idx is None:
            return f"Error: cell_id '{cell_id}' not found"
        cell = cells[target_idx]
        cell["source"] = _split_source(new_source)
        if cell_type:
            cell["cell_type"] = cell_type
        action = f"Replaced cell at index {target_idx}"

    elif edit_mode == "insert":
        if not cell_type:
            return "Error: cell_type is required for insert mode"
        if cell_id is not None and target_idx is None:
            return f"Error: cell_id '{cell_id}' not found"
        new_cell: Dict[str, Any] = {
            "cell_type": cell_type,
            "id": str(uuid.uuid4())[:8],
            "metadata": {},
            "source": _split_source(new_source),
        }
        if cell_type == "code":
            new_cell["execution_count"] = None
            new_cell["outputs"] = []
        insert_at = (target_idx + 1) if target_idx is not None else 0
        cells.insert(insert_at, new_cell)
        action = f"Inserted {cell_type} cell at index {insert_at}"

    elif edit_mode == "delete":
        if target_idx is None:
            return f"Error: cell_id '{cell_id}' not found"
        cells.pop(target_idx)
        action = f"Deleted cell at index {target_idx}"

    else:
        return f"Error: unknown edit_mode '{edit_mode}' (use replace/insert/delete)"

    nb["cells"] = cells
    path.write_text(json.dumps(nb, indent=1, ensure_ascii=False))
    return f"{action} in {path}"


async def _notebook_edit(args: Dict[str, Any], folder: Path) -> str:
    return await asyncio.to_thread(_notebook_edit_sync, args, folder)


register(Tool(
    name="NotebookEdit",
    description=(
        "Completely replaces the contents of a specific cell in a Jupyter "
        "notebook (.ipynb file) with new source. Jupyter notebooks combine "
        "code, text, and visualizations.\n\n"
        "The notebook_path parameter must be absolute. Use edit_mode=insert "
        "to add a new cell after the cell with the given cell_id (or at the "
        "start if no id). Use edit_mode=delete to remove the cell with that id."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "notebook_path": {
                "description": "Absolute path to the .ipynb file",
                "type": "string",
            },
            "cell_id": {
                "description": "ID of the target cell",
                "type": "string",
            },
            "new_source": {
                "description": "The new source for the cell",
                "type": "string",
            },
            "cell_type": {
                "description": "Cell type — required for insert mode",
                "type": "string",
                "enum": ["code", "markdown"],
            },
            "edit_mode": {
                "description": "replace (default) | insert | delete",
                "type": "string",
                "enum": ["replace", "insert", "delete"],
            },
        },
        "required": ["notebook_path", "new_source"],
    },
    executor=_notebook_edit,
    scopes={"main"},
))
