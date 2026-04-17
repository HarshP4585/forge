from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.credentials import AgentKind

SessionStatus = Literal[
    "idle", "running", "awaiting_approval", "error", "stopped"
]


class SessionCreate(BaseModel):
    agent_kind: AgentKind
    model: str = Field(min_length=1)
    folder_path: str = Field(min_length=1)
    title: Optional[str] = None


class Session(BaseModel):
    id: str
    agent_kind: AgentKind
    model: str
    folder_path: str
    title: str
    status: SessionStatus
    created_at: datetime
    updated_at: datetime
    last_active_at: datetime
