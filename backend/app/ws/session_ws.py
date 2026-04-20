import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import runtime
from app.store import sessions as sess_store

router = APIRouter()
log = logging.getLogger(__name__)


@router.websocket("/ws/sessions/{session_id}")
async def session_ws(ws: WebSocket, session_id: str) -> None:
    client = f"{ws.client.host}:{ws.client.port}" if ws.client else "?"
    short_id = session_id[:8]

    if sess_store.get(session_id) is None:
        log.info("[ws %s] reject client=%s — session not found", short_id, client)
        await ws.close(code=1008, reason="Session not found")
        return

    await ws.accept()
    log.info("[ws %s] accepted client=%s", short_id, client)
    rt = runtime.get_or_create(session_id)
    queue = rt.subscribe()

    async def sender() -> None:
        try:
            while True:
                event = await queue.get()
                await ws.send_text(json.dumps(event, default=str))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning(
                "[ws %s] sender stopped (%s: %s)",
                short_id,
                type(exc).__name__,
                exc,
            )

    sender_task = asyncio.create_task(sender())
    close_reason: str = "unknown"

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                log.debug("[ws %s] ignoring non-JSON frame", short_id)
                continue
            kind = msg.get("type")
            if kind == "prompt.submit":
                text = str(msg.get("text", "")).strip()
                attachments = msg.get("attachments") or []
                if not isinstance(attachments, list):
                    attachments = []
                if text or attachments:
                    await rt.submit_prompt(text, attachments)
            elif kind == "interrupt":
                log.info("[ws %s] received interrupt", short_id)
                await rt.interrupt()
            elif kind == "ask.answer":
                qid = msg.get("id")
                answers = msg.get("answers")
                if isinstance(qid, str):
                    rt.resolve_question(qid, answers)
            else:
                log.debug("[ws %s] unknown client event kind=%r", short_id, kind)
        close_reason = "loop exit"
    except WebSocketDisconnect as exc:
        close_reason = f"client disconnect (code={exc.code})"
    except Exception as exc:
        close_reason = f"handler error: {type(exc).__name__}: {exc}"
        log.exception("[ws %s] handler crashed", short_id)
    finally:
        sender_task.cancel()
        try:
            await sender_task
        except (asyncio.CancelledError, BaseException):
            pass
        rt.unsubscribe(queue)
        log.info("[ws %s] closed client=%s reason=%s", short_id, client, close_reason)
