"""Grep tool — regex search over file contents.

Pure-Python implementation: pattern, path, glob filter, output_mode
(content/files_with_matches/count), case insensitive, line numbers,
head_limit + offset, and -A/-B/-C context. Multiline and rg's --type
filter are NOT supported.

Performance guardrails:
- Files larger than MAX_READ_FILE_SIZE are silently skipped
- Binary files are skipped (null-byte heuristic)
- Overall file-count cap via MAX_FILES_SCANNED
- Whole scan runs in a worker thread — parallel subagent Greps don't
  block each other on the event loop.
"""

import asyncio
import re
from pathlib import Path
from typing import Any, Dict, List

from app.tools import Tool, register
from app.tools._common import MAX_READ_FILE_SIZE, is_binary, resolve, truncate

MAX_FILES_SCANNED = 5000


def _grep_sync(args: Dict[str, Any], folder: Path) -> str:
    pattern = args["pattern"]
    base = resolve(folder, args["path"]) if args.get("path") else folder
    file_glob = args.get("glob")
    output_mode = args.get("output_mode", "files_with_matches")
    case_insensitive = bool(args.get("-i"))
    show_line_numbers = args.get("-n", True)
    head_limit = int(args.get("head_limit") or 0)
    offset = int(args.get("offset") or 0)
    ctx_after = int(args.get("-A") or 0)
    ctx_before = int(args.get("-B") or 0)
    ctx = int(args.get("-C") or 0)
    if ctx:
        ctx_after = ctx_after or ctx
        ctx_before = ctx_before or ctx
    multiline = bool(args.get("multiline"))

    flags = re.IGNORECASE if case_insensitive else 0
    if multiline:
        flags |= re.DOTALL | re.MULTILINE

    try:
        regex = re.compile(pattern, flags)
    except re.error as exc:
        return f"Error: invalid regex: {exc}"

    if base.is_file():
        candidates: List[Path] = [base]
    elif base.is_dir():
        glob_pat = file_glob or "**/*"
        candidates = []
        for p in base.glob(glob_pat):
            if p.is_file():
                candidates.append(p)
                if len(candidates) >= MAX_FILES_SCANNED:
                    break
    else:
        return f"Error: not found: {base}"

    files: List[Path] = []
    for f in candidates:
        try:
            if f.stat().st_size > MAX_READ_FILE_SIZE:
                continue
        except OSError:
            continue
        if is_binary(f):
            continue
        files.append(f)

    if output_mode == "files_with_matches":
        matched: List[Path] = []
        for f in files:
            try:
                text = f.read_text(errors="ignore")
            except (OSError, PermissionError):
                continue
            if regex.search(text):
                matched.append(f)
        return _slice([str(p) for p in matched], offset, head_limit)

    if output_mode == "count":
        results: List[str] = []
        for f in files:
            try:
                text = f.read_text(errors="ignore")
            except (OSError, PermissionError):
                continue
            count = len(regex.findall(text))
            if count:
                results.append(f"{f}:{count}")
        return _slice(results, offset, head_limit)

    # output_mode == "content"
    lines: List[str] = []
    for f in files:
        try:
            text = f.read_text(errors="ignore")
        except (OSError, PermissionError):
            continue
        file_lines = text.splitlines()
        match_indices: List[int] = [
            i for i, line in enumerate(file_lines) if regex.search(line)
        ]
        if not match_indices:
            continue
        match_set = set(match_indices)
        emitted: set[int] = set()
        for mi in match_indices:
            start = max(0, mi - ctx_before)
            end = min(len(file_lines), mi + ctx_after + 1)
            for i in range(start, end):
                if i in emitted:
                    continue
                emitted.add(i)
                line = file_lines[i]
                if show_line_numbers:
                    sep = ":" if i in match_set else "-"
                    lines.append(f"{f}{sep}{i + 1}{sep}{line}")
                else:
                    lines.append(f"{f}: {line}")

    return _slice(lines, offset, head_limit)


def _slice(items: List[str], offset: int, head_limit: int) -> str:
    if offset:
        items = items[offset:]
    if head_limit:
        items = items[:head_limit]
    if not items:
        return "(no matches)"
    return truncate("\n".join(items))


async def _grep(args: Dict[str, Any], folder: Path) -> str:
    # Grep may scan thousands of files — one big thread-offload keeps the
    # event loop responsive for parallel subagent tool calls.
    return await asyncio.to_thread(_grep_sync, args, folder)


register(Tool(
    name="Grep",
    description=(
        "A powerful search tool built around regex + glob filtering.\n\n"
        "Usage:\n"
        "- Supports full Python regex syntax\n"
        "- Filter files with `glob` (e.g. '*.js', '*.{ts,tsx}')\n"
        "- output_mode: 'content' shows matching lines; 'files_with_matches' "
        "(default) shows file paths; 'count' shows match counts per file\n"
        "- -i case insensitive; -n line numbers (default true); -A/-B/-C context\n"
        "- head_limit + offset for pagination\n"
        "- Files larger than 10MB and binary files are skipped"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "pattern": {
                "description": "The regular expression pattern to search for in file contents",
                "type": "string",
            },
            "path": {
                "description": "File or directory to search in. Defaults to session folder.",
                "type": "string",
            },
            "glob": {
                "description": "Glob pattern to filter files (e.g. '*.js', '*.{ts,tsx}')",
                "type": "string",
            },
            "output_mode": {
                "description": "Output mode: content | files_with_matches | count",
                "type": "string",
                "enum": ["content", "files_with_matches", "count"],
            },
            "-B": {"type": "number"},
            "-A": {"type": "number"},
            "-C": {"type": "number"},
            "-n": {"type": "boolean"},
            "-i": {"type": "boolean"},
            "head_limit": {"type": "number"},
            "offset": {"type": "number"},
            "multiline": {"type": "boolean"},
        },
        "required": ["pattern"],
    },
    executor=_grep,
    scopes={"main", "sub"},
))
