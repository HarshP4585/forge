from typing import List, Optional

from pydantic import BaseModel, Field


class FolderValidateRequest(BaseModel):
    path: str = Field(min_length=1)


class FolderValidateResponse(BaseModel):
    exists: bool
    is_dir: bool
    resolved_path: Optional[str] = None


class FolderEntry(BaseModel):
    name: str
    is_dir: bool


class FolderListResponse(BaseModel):
    path: str
    parent: Optional[str] = None
    entries: List[FolderEntry]
