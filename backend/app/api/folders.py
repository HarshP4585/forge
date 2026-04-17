from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, status

from app.schemas.folders import (
    FolderEntry,
    FolderListResponse,
    FolderValidateRequest,
    FolderValidateResponse,
)

router = APIRouter(prefix="/api/folders", tags=["folders"])


@router.post("/validate", response_model=FolderValidateResponse)
async def validate_folder(body: FolderValidateRequest) -> FolderValidateResponse:
    p = Path(body.path).expanduser()
    try:
        resolved = p.resolve(strict=False)
    except Exception:
        return FolderValidateResponse(
            exists=False, is_dir=False, resolved_path=None
        )
    return FolderValidateResponse(
        exists=resolved.exists(),
        is_dir=resolved.is_dir(),
        resolved_path=str(resolved),
    )


@router.get("/list", response_model=FolderListResponse)
async def list_folder(
    path: Optional[str] = None,
    include_files: bool = False,
) -> FolderListResponse:
    if path:
        p = Path(path).expanduser().resolve()
    else:
        p = Path.home().resolve()

    if not p.exists():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Does not exist: {p}"
        )
    if not p.is_dir():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Not a directory: {p}"
        )

    entries: List[FolderEntry] = []
    try:
        # Dirs first (sorted), then files (sorted) — makes for a nicer list.
        items = sorted(
            p.iterdir(),
            key=lambda x: (not x.is_dir(), x.name.lower()),
        )
    except PermissionError:
        items = []

    for item in items:
        if item.name.startswith("."):
            continue
        try:
            is_dir = item.is_dir()
        except OSError:
            continue
        if is_dir:
            entries.append(FolderEntry(name=item.name, is_dir=True))
        elif include_files:
            entries.append(FolderEntry(name=item.name, is_dir=False))

    parent = str(p.parent) if p.parent != p else None
    return FolderListResponse(path=str(p), parent=parent, entries=entries)
