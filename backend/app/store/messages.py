import json
from datetime import datetime, timezone
from typing import Any, Dict, List

from app.db import get_conn


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def append(session_id: str, event: Dict[str, Any]) -> Dict[str, Any]:
    """Append an event to the session's log. Returns the event enriched with
    seq + created_at (same shape that WS clients and history consumers see)."""
    now = _now_iso()
    with get_conn() as conn:
        try:
            conn.execute("BEGIN")
            row = conn.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            seq = int(row["next"])
            conn.execute(
                """
                INSERT INTO messages (session_id, seq, created_at, event)
                VALUES (?, ?, ?, ?)
                """,
                (session_id, seq, now, json.dumps(event)),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return {**event, "seq": seq, "created_at": now}


def list_for_session(session_id: str) -> List[Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT seq, created_at, event
              FROM messages
             WHERE session_id = ?
             ORDER BY seq
            """,
            (session_id,),
        ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        try:
            evt = json.loads(r["event"])
        except json.JSONDecodeError:
            continue
        out.append({**evt, "seq": r["seq"], "created_at": r["created_at"]})
    return out
