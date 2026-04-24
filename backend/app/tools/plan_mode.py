"""Plan mode — let the model propose a plan before executing anything.

When the model invokes ``EnterPlanMode(plan=...)``, the session flips
into plan mode:

- The plan text is emitted as a ``plan.proposal`` event so the UI can
  render it as a decision card (Accept / Reject with optional feedback).
- Any subsequent mutating tool call during the same turn or the next
  user turn is denied by the agent loop until the user resolves the
  plan — the model can still explore with Read/Grep/Glob/WebSearch.

Exiting plan mode is user-driven (not model-driven) for v1 so the model
can't shortcut around the user's approval by calling ``ExitPlanMode``
itself. If the user rejects with feedback, the feedback is surfaced as
a synthetic user message so the model sees it and can revise.
"""

from pathlib import Path
from typing import Any, Dict

from app.tools import Tool, get_session_context, register

ENTER_PLAN_MODE = "EnterPlanMode"


async def _enter_plan_mode(args: Dict[str, Any], folder: Path) -> str:
    plan = args.get("plan")
    if not isinstance(plan, str) or not plan.strip():
        return "Error: 'plan' is required and must be non-empty markdown."

    ctx = get_session_context()
    enter_cb = ctx.get("enter_plan_mode")
    if enter_cb is None:
        # Runtime didn't pipe the callback (shouldn't happen in prod;
        # happens in unit tests that construct a bare context). Degrade
        # gracefully instead of crashing the turn.
        return (
            "Plan recorded (but runtime integration is missing — the "
            "plan card won't render). "
        )
    try:
        await enter_cb(plan.strip())
    except Exception as exc:
        return f"Error entering plan mode: {exc}"
    return (
        "Plan recorded and shown to the user. STOP making tool calls and "
        "wait for their decision. If they reject with feedback, revise "
        "the plan and call EnterPlanMode again."
    )


register(Tool(
    name=ENTER_PLAN_MODE,
    description=(
        "Propose a plan for the user to review before making any "
        "modifications. Use this whenever the requested task is "
        "non-trivial (multi-file changes, refactors, new features, "
        "schema migrations) and you want a green-light before you start "
        "editing / running things.\n\n"
        "While the plan is pending, the session is in PLAN MODE:\n"
        "- Mutating tools (Bash, Write, Edit, MultiEdit, NotebookEdit, "
        "  WebFetch) will be blocked until the user Accepts.\n"
        "- You can still explore freely with Read, Grep, Glob, WebSearch.\n\n"
        "Arguments:\n"
        "- plan: markdown text describing what you'll do, in step order. "
        "  Include the critical files you'll touch, risks, and the "
        "  verification step. Keep it scannable — the user is reading it."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "plan": {
                "type": "string",
                "description": (
                    "Markdown plan. Lead with a one-line summary, then "
                    "step-by-step actions, then a verification section."
                ),
            },
        },
        "required": ["plan"],
    },
    executor=_enter_plan_mode,
    scopes={"main"},
))
