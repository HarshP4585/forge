"""Shared helpers for tool executors."""

from pathlib import Path

MAX_OUTPUT_CHARS = 30_000
MAX_READ_FILE_SIZE = 10 * 1024 * 1024  # 10 MB — bigger files aren't read by Read/Grep


def resolve(folder: Path, path_str: str) -> Path:
    """Resolve a user-supplied path. Absolute paths are respected; relative
    paths are interpreted against the session folder."""
    p = Path(path_str).expanduser()
    if not p.is_absolute():
        p = folder / p
    return p.resolve()


def truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... (truncated, {len(text) - limit} more chars)"


def is_binary(path: Path, sample_bytes: int = 4096) -> bool:
    """Heuristic: a null byte in the first 4KB means binary. Fast and
    good-enough for skipping images, executables, compiled artifacts, etc."""
    try:
        with path.open("rb") as fh:
            chunk = fh.read(sample_bytes)
    except OSError:
        return True
    return b"\x00" in chunk
