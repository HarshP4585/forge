"""Conversation compactor.

Asks the session's own provider to summarize the current conversation
into a compressed form. The caller (``SessionRuntime.compact``) then
replaces the in-memory history with the summary so subsequent turns
run against a much smaller context. The DB event log is never
touched — the UI still shows every original message.

Separate from ``agent.py`` because it has no tools, no streaming
fan-out, no multi-round loop. Just history → summary text.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from app.llm.providers import build_provider

log = logging.getLogger(__name__)

COMPACT_SYSTEM_PROMPT = """You are compacting a coding-assistant conversation so it can continue under a tighter context budget. Produce a concise summary that preserves everything the next turn will need:

- The user's primary goal and any sub-goals
- Key decisions made and trade-offs discussed
- Files that were read, edited, or created (use full paths)
- Tool outputs that are still relevant (errors being debugged, test results, data you'll reference later)
- Unresolved questions or pending work
- The current state of any in-progress task

Do NOT include:
- Pleasantries, small talk, or meta commentary
- Duplicate information
- Tool outputs that were superseded by later ones
- The system prompt itself — just the conversation

Reply with just the summary. No preamble, no "here is the summary", no markdown headers. Use tight prose or compact bullets where they help. Optimize for density.""".strip()


# Limits — we're sending the full history to the summarizer. Cap the
# transcript at a reasonable size so the summarizer itself doesn't blow
# context on a very long conversation (extremely rare, but possible).
_MAX_TRANSCRIPT_CHARS = 200_000


async def _noop_emit(_event: Dict[str, Any]) -> None:
    pass


def _extract_transcript(history: List[Dict[str, Any]]) -> str:
    """Collapse the Anthropic-shaped block history into a plain
    ``role: text`` transcript. Tool calls + tool results are included
    (as concise labels) since they usually carry the meat of a coding
    conversation. Images and thinking blocks are dropped."""
    lines: List[str] = []
    for m in history:
        role = m.get("role", "")
        content = m.get("content", "")
        if isinstance(content, str):
            if content.strip():
                lines.append(f"{role}: {content.strip()}")
            continue
        chunks: List[str] = []
        for block in content or []:
            t = block.get("type")
            if t == "text":
                chunks.append(block.get("text", "") or "")
            elif t == "tool_use":
                name = block.get("name", "?")
                inp = block.get("input", {})
                chunks.append(f"[tool_use {name}({_short_json(inp)})]")
            elif t == "tool_result":
                out = str(block.get("content", ""))
                # Tool outputs can be huge — keep them trimmed in the
                # transcript; the summarizer only needs the gist.
                if len(out) > 800:
                    out = out[:800] + " …[truncated]"
                chunks.append(f"[tool_result {out}]")
            # skip image + thinking
        joined = "\n".join(c for c in chunks if c).strip()
        if joined:
            lines.append(f"{role}: {joined}")
    text = "\n\n".join(lines)
    return text[:_MAX_TRANSCRIPT_CHARS]


def _short_json(obj: Any) -> str:
    import json
    try:
        s = json.dumps(obj, ensure_ascii=False)
    except Exception:
        return "?"
    if len(s) > 160:
        return s[:160] + "…"
    return s


async def generate_summary(
    *,
    agent_kind: str,
    model: str,
    api_key: str,
    history: List[Dict[str, Any]],
) -> Optional[str]:
    """Summarize the given history. Returns the summary string or
    ``None`` if the provider call fails or produces nothing."""
    if not history:
        return None
    transcript = _extract_transcript(history)
    if not transcript:
        return None

    user_prompt = (
        f"Conversation to compact:\n\n{transcript}\n\n"
        "Now produce the compacted summary."
    )
    provider = build_provider(agent_kind, api_key)
    try:
        result = await provider.stream_turn(
            system=COMPACT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            tools=[],
            model=model,
            emit=_noop_emit,
        )
        summary = (result.get("text") or "").strip()
        return summary or None
    except BaseException as exc:
        log.info(
            "compactor: generation failed (%s: %s)",
            type(exc).__name__,
            exc,
        )
        return None
    finally:
        try:
            await provider.close()
        except Exception:
            pass


def estimate_tokens(text: str) -> int:
    """Rough token estimate — close enough for UI meters where the
    exact value doesn't matter. Actual counts arrive on the next turn's
    usage event, at which point this estimate is replaced."""
    return max(1, len(text) // 4)
