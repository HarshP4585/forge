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
from app.llm.compactor import estimate_tokens, generate_summary
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
        # Set while a compact is in flight so we don't kick off a
        # second one concurrently and so run_turn / submit_prompt can
        # check before proceeding.
        self._compacting: bool = False
        # True once we've rehydrated from the DB (or confirmed there
        # was nothing to rehydrate). Rehydration happens lazily on
        # first ``get_or_create`` so cold sessions don't pay for it.
        self._hydrated: bool = False

    def _maybe_hydrate(self) -> None:
        """Rebuild ``_history`` from persisted events. Runs once per
        runtime; subsequent calls are no-ops. Tolerant to missing /
        malformed events — partial history is better than none.
        """
        if self._hydrated:
            return
        self._hydrated = True
        try:
            events = msg_store.list_for_session(self.session_id)
        except Exception as exc:
            log.warning(
                "[runtime %s] hydrate: failed to load events (%s: %s)",
                self.session_id[:8],
                type(exc).__name__,
                exc,
            )
            return
        if not events:
            return
        self._history = _rehydrate_history(events)
        # After rehydration this is no longer the "first turn" — the
        # Claude system-reminder block has already been sent on some
        # prior turn (persisted into DB and thus recovered).
        self._is_first_turn = False
        log.info(
            "[runtime %s] hydrated %d messages from %d events",
            self.session_id[:8],
            len(self._history),
            len(events),
        )

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
            if self._compacting:
                await self.emit({
                    "type": "error",
                    "message": "Session is compacting, try again in a moment.",
                })
                return
            self._turn_task = asyncio.create_task(
                self._run_turn(prompt, attachments or [])
            )

    async def compact(self) -> None:
        """Summarize the in-memory history into a compressed form and
        replace it, so subsequent turns run against a much smaller
        context. Emits ``compact.start`` / ``compact.result`` so the
        UI can toggle its "compacting" indicator; also emits a
        follow-up ``usage`` event carrying the estimated new token
        count so the context meter updates immediately (the exact
        count lands on the next real turn).

        Refuses to run concurrently with a turn or another compact.
        The DB event log is never touched — users scrolling back still
        see the full original transcript in the UI.
        """
        async with self._lock:
            if self._turn_task and not self._turn_task.done():
                await self.emit({
                    "type": "error",
                    "message": "Can't compact while a turn is running. Stop it first.",
                })
                return
            if self._compacting:
                await self.emit({
                    "type": "system.notice",
                    "level": "info",
                    "text": "Compact already in progress.",
                })
                return
            if not self._history:
                await self.emit({
                    "type": "system.notice",
                    "level": "info",
                    "text": "Nothing to compact yet — send a prompt first.",
                })
                return
            sess = sess_store.get(self.session_id)
            if sess is None:
                return
            api_key = cred_store.get_key(sess.agent_kind) or ""
            if not api_key:
                await self.emit({
                    "type": "error",
                    "message": f"No API key configured for {sess.agent_kind}.",
                })
                return
            # Claim the slot under the lock so a concurrent compact /
            # submit sees our flag and bails.
            self._compacting = True
            model_for_call = sess.model or default_model(sess.agent_kind)

        # The summarizer call can take several seconds — run it
        # outside the submit lock so status emits and front-end events
        # don't stall.
        try:
            await self.emit({"type": "compact.start"})
            summary = await generate_summary(
                agent_kind=sess.agent_kind,
                model=model_for_call,
                api_key=api_key,
                history=self._history,
            )
            if not summary:
                await self.emit({
                    "type": "error",
                    "message": "Compact failed — summarizer returned nothing. History not changed.",
                })
                await self.emit({"type": "compact.result", "ok": False})
                return

            # Replace LLM-facing history with a synthetic summary pair.
            self._history = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Summarize our conversation so far.",
                        }
                    ],
                },
                {
                    "role": "assistant",
                    "content": [{"type": "text", "text": summary}],
                },
            ]
            estimated = estimate_tokens(summary)

            await self.emit({
                "type": "system.notice",
                "level": "info",
                "text": f"Conversation compacted (≈{estimated:,} tokens).",
            })
            await self.emit({
                "type": "compact.result",
                "ok": True,
                "estimated_tokens": estimated,
            })
            # Drop the context meter to the new size immediately; the
            # next real turn's usage event will replace this estimate
            # with the exact count.
            await self.emit({
                "type": "usage",
                "input_tokens": estimated,
                "output_tokens": 0,
            })
        finally:
            self._compacting = False

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
        # Rehydrate the LLM-facing history from the persisted event
        # log. Synchronous (just walks a list of dicts) — fast enough
        # to run inline even for long conversations.
        rt._maybe_hydrate()
        _sessions[session_id] = rt
    return rt


def _rehydrate_history(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Reconstruct the Anthropic-shaped ``_history`` list from the
    persisted event stream.

    Walks events in order and re-assembles:
      message.user         → {role: 'user', content: [text]}
      assistant.complete   → {role: 'assistant', content: [text]}
      tool.call.start      → append {type: 'tool_use'} to current assistant
      tool.call.result     → buffer until all this turn's tool uses are
                             resolved, then flush as a user message of
                             tool_result blocks

    Image attachments are not recoverable (only metadata is persisted —
    the raw base64 isn't) so any prior image content is silently lost.
    That matches the documented limitation in CONTEXT.md.
    """
    history: List[Dict[str, Any]] = []
    current_assistant: Optional[Dict[str, Any]] = None
    tool_uses_pending: Dict[str, bool] = {}
    tool_results_pending: List[Dict[str, Any]] = []

    def flush_tool_results() -> None:
        nonlocal tool_results_pending, current_assistant
        if tool_results_pending:
            history.append({"role": "user", "content": tool_results_pending})
            tool_results_pending = []
        current_assistant = None

    for e in events:
        t = e.get("type")
        if t == "message.user":
            # A new user prompt closes any pending tool-result group.
            flush_tool_results()
            text = str(e.get("text") or "")
            content: List[Dict[str, Any]] = []
            if text:
                content.append({"type": "text", "text": text})
            history.append({"role": "user", "content": content})
        elif t == "assistant.complete":
            text = str(e.get("text") or "")
            current_assistant = {"role": "assistant", "content": []}
            if text:
                current_assistant["content"].append(
                    {"type": "text", "text": text}
                )
            history.append(current_assistant)
        elif t == "tool.call.start":
            call_id = str(e.get("call_id") or "")
            name = str(e.get("tool") or "")
            inp = e.get("input") if isinstance(e.get("input"), dict) else {}
            if current_assistant is not None and call_id and name:
                current_assistant["content"].append({
                    "type": "tool_use",
                    "id": call_id,
                    "name": name,
                    "input": inp,
                })
                tool_uses_pending[call_id] = True
        elif t == "tool.call.result":
            call_id = str(e.get("call_id") or "")
            output = e.get("output") or ""
            is_error = bool(e.get("is_error"))
            if call_id:
                tool_results_pending.append({
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": str(output),
                    "is_error": is_error,
                })
                tool_uses_pending.pop(call_id, None)
                # When every tool call for this assistant turn has
                # resolved, flush them as the next user message and
                # close out the current assistant.
                if not tool_uses_pending:
                    flush_tool_results()

    # Anything still buffered at the end — e.g. a turn interrupted
    # mid-flight — gets appended so history reflects reality.
    if tool_results_pending:
        history.append({"role": "user", "content": tool_results_pending})

    return history


def peek(session_id: str) -> Optional[SessionRuntime]:
    return _sessions.get(session_id)


async def remove(session_id: str) -> None:
    rt = _sessions.pop(session_id, None)
    if rt is not None:
        await rt.close()
