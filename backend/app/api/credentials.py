from fastapi import APIRouter, HTTPException, status

from app.schemas.credentials import AgentKind, CredentialSet, CredentialStatus
from app.store import credentials as store

router = APIRouter(prefix="/api/credentials", tags=["credentials"])


@router.get("", response_model=list[CredentialStatus])
async def list_credentials() -> list[CredentialStatus]:
    return store.list_status()


@router.put("/{agent_kind}", response_model=CredentialStatus)
async def set_credential(agent_kind: AgentKind, body: CredentialSet) -> CredentialStatus:
    key = body.api_key.strip()
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "api_key must not be empty")
    return store.upsert_key(agent_kind, key)


@router.delete("/{agent_kind}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(agent_kind: AgentKind) -> None:
    existed = store.delete_key(agent_kind)
    if not existed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no credentials for {agent_kind}")
