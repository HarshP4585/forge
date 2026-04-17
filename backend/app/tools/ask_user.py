"""AskUserQuestion — blocks the tool loop until the user answers via the UI.

Runtime mechanism:
- Session runtime exposes an ``ask_user(questions) -> answers`` coroutine
  and injects it into the session context.
- This tool emits an ``ask.question`` event through the runtime and awaits
  a Future that the WS handler resolves when the user submits
  ``ask.answer``.
"""

import json
from pathlib import Path
from typing import Any, Dict

from app.tools import Tool, get_session_context, register


async def _ask_user(args: Dict[str, Any], _folder: Path) -> str:
    ctx = get_session_context()
    ask_fn = ctx.get("ask_user")
    if ask_fn is None:
        return (
            "Error: AskUserQuestion is not available in this context "
            "(no interactive channel)."
        )

    questions = args.get("questions") or []
    if not questions:
        return "Error: no questions provided"

    answers = await ask_fn(questions)
    return json.dumps(answers, ensure_ascii=False)


register(Tool(
    name="AskUserQuestion",
    description=(
        "Ask the user one or more multiple-choice questions and wait for "
        "their response. Useful to clarify requirements, validate "
        "assumptions, or present design options.\n\n"
        "- 1 to 4 questions per call\n"
        "- Each question has 2-4 options (the UI adds 'Other' automatically)\n"
        "- Set multiSelect=true to allow multiple options per question"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "header": {"type": "string"},
                        "options": {
                            "type": "array",
                            "minItems": 2,
                            "maxItems": 4,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": {"type": "string"},
                                    "description": {"type": "string"},
                                },
                                "required": ["label", "description"],
                            },
                        },
                        "multiSelect": {"type": "boolean"},
                    },
                    "required": ["question", "header", "options"],
                },
            },
        },
        "required": ["questions"],
    },
    executor=_ask_user,
    scopes={"main"},
))
