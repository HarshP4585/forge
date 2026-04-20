"""In-process session registry.

Holds per-session conversation history + WS subscribers, and kicks off
turns by calling ``llm.agent.run_turn``. Also owns the ``ask_user``
round-trip: when a tool asks a question, we emit an ``ask.question`` event
and await a Future that the WS handler resolves when the client POSTs an
``ask.answer`` message.
"""

import asyncio
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from app.llm.agent import default_model, run_turn
from app.llm.titler import generate_title
from app.store import credentials as cred_store
from app.store import messages as msg_store
from app.store import sessions as sess_store

log = logging.getLogger(__name__)


class SessionRuntime:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self._subscribers: Set[asyncio.Queue] = set()
        self._turn_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self._history: List[Dict[str, Any]] = []
        self._is_first_turn = True
        self._pending_questions: Dict[str, asyncio.Future] = {}

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    async def emit(self, event: Dict[str, Any]) -> None:
        stored = msg_store.append(self.session_id, event)
        for q in list(self._subscribers):
            try:
                q.put_nowait(stored)
            except asyncio.QueueFull:
                pass

    async def ask_user(self, questions: List[Dict[str, Any]]) -> Any:
        """AskUserQuestion round-trip. Emits ``ask.question``; blocks on a
        Future that ``resolve_question(qid, answers)`` completes."""
        qid = f"q-{uuid.uuid4()}"
        loop = asyncio.get_event_loop()
        future: asyncio.Future = loop.create_future()
        self._pending_questions[qid] = future
        await self.emit({
            "type": "ask.question",
            "id": qid,
            "questions": questions,
        })
        try:
            return await future
        finally:
            self._pending_questions.pop(qid, None)

    def resolve_question(self, qid: str, answers: Any) -> bool:
        future = self._pending_questions.get(qid)
        if future is None or future.done():
            return False
        future.set_result(answers)
        return True

    async def submit_prompt(
        self,
        prompt: str,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        async with self._lock:
            if self._turn_task and not self._turn_task.done():
                await self.emit({
                    "type": "error",
                    "message": "Session is busy, wait for the current turn to finish.",
                })
                return
            self._turn_task = asyncio.create_task(
                self._run_turn(prompt, attachments or [])
            )

    async def interrupt(self) -> None:
        short = self.session_id[:8]
        has_task = self._turn_task is not None and not self._turn_task.done()
        pending_q_count = sum(
            1 for f in self._pending_questions.values() if not f.done()
        )
        log.info(
            "[runtime %s] interrupt requested — active_turn=%s pending_questions=%d",
            short,
            has_task,
            pending_q_count,
        )
        if has_task:
            self._turn_task.cancel()
        # Reject any still-pending AskUserQuestion so tools unblock cleanly.
        for qid, fut in list(self._pending_questions.items()):
            if not fut.done():
                fut.set_exception(asyncio.CancelledError())
            self._pending_questions.pop(qid, None)
        if not has_task and pending_q_count == 0:
            # No in-flight work — still emit a stopped status so the UI
            # leaves the "Running" state. This can happen if the turn
            # finished between the click and the event arriving.
            sess_store.update_status(self.session_id, "stopped")
            await self.emit({"type": "session.status", "status": "stopped"})

    async def _maybe_retitle(self, prompt: str) -> None:
        """First-paint heuristic title: use the first line of the user's
        prompt if the session is still carrying the default "New X
        session" name. The LLM titler later refines it after the turn
        completes — this exists so the sidebar shows something sensible
        immediately instead of staying on ``New X session`` until the
        assistant finishes streaming.
        """
        sess = sess_store.get(self.session_id)
        if sess is None:
            return
        is_default = sess.title.startswith("New ") and sess.title.endswith(" session")
        if not is_default:
            return
        candidate = prompt.strip().splitlines()[0][:60] if prompt.strip() else ""
        if not candidate:
            return
        sess_store.update_title(self.session_id, candidate)
        await self.emit({"type": "session.title", "title": candidate})

    async def _refine_title_via_llm(self) -> None:
        """Ask the session's provider for a polished summary title and
        write it back. Runs as a background task after each successful
        turn; swallows all failures. A no-op if the key is missing or
        the titler returns nothing.
        """
        sess = sess_store.get(self.session_id)
        if sess is None:
            return
        api_key = cred_store.get_key(sess.agent_kind)
        if not api_key:
            return
        model = sess.model or default_model(sess.agent_kind)
        try:
            title = await generate_title(
                agent_kind=sess.agent_kind,
                model=model,
                api_key=api_key,
                history=self._history,
            )
        except BaseException:
            # generate_title already swallows, but be defensive.
            return
        if not title or title == sess.title:
            return
        sess_store.update_title(self.session_id, title)
        await self.emit({"type": "session.title", "title": title})

    async def _run_turn(
        self,
        prompt: str,
        attachments: List[Dict[str, Any]],
    ) -> None:
        sess_store.update_status(self.session_id, "running")
        await self.emit({"type": "session.status", "status": "running"})
        # message.user echoes attachment metadata (not the raw image data) so
        # history replays show the attachment chips without re-sending MBs.
        att_meta = [
            {"kind": a.get("kind"), "name": a.get("name")}
            for a in attachments
            if isinstance(a, dict)
        ]
        await self.emit({
            "type": "message.user",
            "text": prompt,
            "id": f"user-{uuid.uuid4()}",
            "attachments": att_meta,
        })
        await self._maybe_retitle(prompt)

        sess = sess_store.get(self.session_id)
        if sess is None:
            await self.emit({"type": "error", "message": "Session not found"})
            return
        api_key = cred_store.get_key(sess.agent_kind)
        if not api_key:
            sess_store.update_status(self.session_id, "error")
            await self.emit({
                "type": "error",
                "message": f"No API key configured for {sess.agent_kind}. Add it in Settings.",
            })
            await self.emit({"type": "session.status", "status": "error"})
            return

        model = sess.model or default_model(sess.agent_kind)

        try:
            await run_turn(
                agent_kind=sess.agent_kind,
                model=model,
                api_key=api_key,
                folder=Path(sess.folder_path),
                history=self._history,
                prompt=prompt,
                attachments=attachments,
                emit=self.emit,
                is_first_turn=self._is_first_turn,
                ask_user=self.ask_user,
            )
            self._is_first_turn = False
            sess_store.update_status(self.session_id, "idle")
            await self.emit({"type": "turn.done"})
            await self.emit({"type": "session.status", "status": "idle"})
            # Refresh the title in the background. Fire-and-forget — the
            # UI already has the turn's output; the title update is an
            # ambient polish and must never block or fail a real turn.
            asyncio.create_task(self._refine_title_via_llm())
        except asyncio.CancelledError:
            sess_store.update_status(self.session_id, "stopped")
            await self.emit({"type": "session.status", "status": "stopped"})
            raise
        except Exception as exc:
            sess_store.update_status(self.session_id, "error")
            await self.emit({
                "type": "error",
                "message": str(exc),
                "detail": {"type": type(exc).__name__},
            })
            await self.emit({"type": "session.status", "status": "error"})

    async def close(self) -> None:
        if self._turn_task and not self._turn_task.done():
            self._turn_task.cancel()
            try:
                await self._turn_task
            except BaseException:
                pass


_sessions: Dict[str, SessionRuntime] = {}


def get_or_create(session_id: str) -> SessionRuntime:
    rt = _sessions.get(session_id)
    if rt is None:
        rt = SessionRuntime(session_id)
        _sessions[session_id] = rt
    return rt


def peek(session_id: str) -> Optional[SessionRuntime]:
    return _sessions.get(session_id)


async def remove(session_id: str) -> None:
    rt = _sessions.pop(session_id, None)
    if rt is not None:
        await rt.close()
