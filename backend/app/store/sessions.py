import sqlite3
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from app.db import get_conn
from app.schemas.sessions import Session, SessionCreate, SessionStatus


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_session(row: sqlite3.Row) -> Session:
    return Session(
        id=row["id"],
        agent_kind=row["agent_kind"],
        model=row["model"] or "",
        folder_path=row["folder_path"],
        title=row["title"],
        status=row["status"],
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]),
        last_active_at=datetime.fromisoformat(row["last_active_at"]),
    )


def create(payload: SessionCreate) -> Session:
    now = _now_iso()
    session_id = str(uuid.uuid4())
    title = (payload.title or "").strip() or f"New {payload.agent_kind} session"
    with get_conn() as conn:
        try:
            conn.execute("BEGIN")
            conn.execute(
                """
                INSERT INTO sessions
                    (id, agent_kind, model, folder_path, title, status,
                     created_at, updated_at, last_active_at, extras)
                VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?, '{}')
                """,
                (
                    session_id,
                    payload.agent_kind,
                    payload.model,
                    payload.folder_path,
                    title,
                    now,
                    now,
                    now,
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    created = get(session_id)
    assert created is not None
    return created


def get(session_id: str) -> Optional[Session]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
    return _row_to_session(row) if row else None


def list_all() -> List[Session]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions ORDER BY last_active_at DESC"
        ).fetchall()
    return [_row_to_session(r) for r in rows]


def delete(session_id: str) -> bool:
    with get_conn() as conn:
        try:
            conn.execute("BEGIN")
            cur = conn.execute(
                "DELETE FROM sessions WHERE id = ?", (session_id,)
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return cur.rowcount > 0


def update_status(session_id: str, status: SessionStatus) -> None:
    now = _now_iso()
    with get_conn() as conn:
        try:
            conn.execute("BEGIN")
            conn.execute(
                """
                UPDATE sessions
                   SET status = ?, updated_at = ?, last_active_at = ?
                 WHERE id = ?
                """,
                (status, now, now, session_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def update_model(session_id: str, model: str) -> None:
    now = _now_iso()
    with get_conn() as conn:
        try:
            conn.execute("BEGIN")
            conn.execute(
                "UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?",
                (model, now, session_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def update_title(session_id: str, title: str) -> None:
    now = _now_iso()
    with get_conn() as conn:
        try:
            conn.execute("BEGIN")
            conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
                (title, now, session_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
