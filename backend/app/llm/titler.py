"""LLM-powered session titler.

Runs as a background task after each successful turn. Asks the session's
own provider for a concise summary title of the current conversation and
writes it back via ``sess_store.update_title``. Failures are swallowed —
this is a cosmetic feature, never worth breaking a turn over.

Kept separate from ``agent.py`` because the contract is completely
different: no tools, no history mutation, no streaming fan-out. Just
prompt → text.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from app.llm.providers import build_provider

log = logging.getLogger(__name__)

TITLE_SYSTEM_PROMPT = """You title coding-assistant conversations.

Produce a concise 3-6 word title that captures what the user is trying
to accomplish. Plain text only — no surrounding quotes, no trailing
punctuation, no "Title:" prefix, no emoji.

Examples:
- Debug auth middleware login flow
- Refactor sidebar component layout
- Fix failing pytest imports
- Add WebSocket reconnect logic
- Investigate SQLite migration errors
""".strip()

# Cap on the transcript we show the titler. A few recent turns of text
# are plenty; stuffing full histories in wastes tokens and doesn't help
# title quality.
_MAX_MESSAGES = 10
_MAX_TRANSCRIPT_CHARS = 4000
# Final title can't be longer than this — prevents a runaway model from
# returning a paragraph.
_MAX_TITLE_CHARS = 80


async def _noop_emit(_event: Dict[str, Any]) -> None:
    pass


def _extract_transcript(history: List[Dict[str, Any]]) -> str:
    """Collapse our Anthropic-shaped block history into a plain
    ``role: text`` transcript. Tool calls, tool results, images, and
    reasoning blocks are dropped — they're noise for a summarizer.
    """
    lines: List[str] = []
    for m in history[:_MAX_MESSAGES]:
        role = m.get("role", "")
        content = m.get("content", "")
        if isinstance(content, str):
            if content.strip():
                lines.append(f"{role}: {content.strip()}")
            continue
        texts: List[str] = []
        for block in content or []:
            if block.get("type") == "text":
                txt = (block.get("text") or "").strip()
                if txt:
                    texts.append(txt)
        joined = "\n".join(texts).strip()
        if joined:
            lines.append(f"{role}: {joined}")
    return "\n".join(lines)[:_MAX_TRANSCRIPT_CHARS]


def _clean_title(raw: str) -> str:
    """Strip formatting quirks some models inject even with explicit
    instructions — leading ``Title:`` labels, wrapping quotes, trailing
    periods, stray newlines.
    """
    t = raw.strip()
    for prefix in ("Title:", "title:", "TITLE:"):
        if t.lower().startswith(prefix.lower()):
            t = t[len(prefix):].strip()
    t = t.strip("\"'`“”‘’")
    t = t.rstrip(".!?")
    t = " ".join(t.split())
    return t[:_MAX_TITLE_CHARS]


async def generate_title(
    *,
    agent_kind: str,
    model: str,
    api_key: str,
    history: List[Dict[str, Any]],
) -> Optional[str]:
    """Return a cleaned-up title string, or ``None`` if the call failed
    or produced nothing useful. Never raises.
    """
    transcript = _extract_transcript(history)
    if not transcript:
        return None

    user_prompt = f"Conversation so far:\n{transcript}\n\nTitle:"

    provider = build_provider(agent_kind, api_key)
    try:
        result = await provider.stream_turn(
            system=TITLE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            tools=[],
            model=model,
            emit=_noop_emit,
        )
        raw = (result.get("text") or "").strip()
        title = _clean_title(raw)
        return title or None
    except BaseException as exc:
        log.info("titler: generation failed (%s: %s)", type(exc).__name__, exc)
        return None
    finally:
        try:
            await provider.close()
        except Exception:
            pass
