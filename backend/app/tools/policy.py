"""Per-tool approval policy.

Mirrors Claude Code's "run bold, confirm risky" posture: safe read-only
tools auto-run, anything that writes / executes / reaches out to the
network pauses for a user approval card.

For v1 this is a hard-coded default map. Per-user overrides + a Settings
UI come later (see plan for #1); the shape of ``needs_approval`` is the
stable public surface — callers won't change when storage grows a DB
backing.
"""

from __future__ import annotations

from typing import Dict, Literal

Policy = Literal["allow", "ask", "deny"]

# Default trust matrix. Keep it tight: any tool that mutates the repo or
# reaches the network asks first. Read-only inspection runs free.
DEFAULT_POLICY: Dict[str, Policy] = {
    # Read-only — auto
    "Read": "allow",
    "Glob": "allow",
    "Grep": "allow",
    # Todo system is cheap + reversible — auto
    "TaskCreate": "allow",
    "TaskGet": "allow",
    "TaskUpdate": "allow",
    "TaskList": "allow",
    # Subagent lifecycle is bounded (read-only subagents); auto
    "Task": "allow",
    "TaskStop": "allow",
    "TaskOutput": "allow",
    # User-interaction tool is always safe
    "AskUserQuestion": "allow",
    # Plan mode is a UI-level gate; approval happens via the plan card
    "EnterPlanMode": "allow",
    # Memory: local file ops on user's own folder — auto for now
    "Memory": "allow",
    # Mutating or side-effecting — ask
    "Bash": "ask",
    "Write": "ask",
    "Edit": "ask",
    "MultiEdit": "ask",
    "NotebookEdit": "ask",
    # Network — ask (exfiltration + unpredictable content)
    "WebFetch": "ask",
    "WebSearch": "ask",
}


def policy_for(tool_name: str) -> Policy:
    """Policy for a tool; unknown names default to ``ask`` so new tools
    are safe-by-default until someone explicitly adds them."""
    return DEFAULT_POLICY.get(tool_name, "ask")


def needs_approval(tool_name: str) -> bool:
    return policy_for(tool_name) == "ask"


def is_blocked(tool_name: str) -> bool:
    return policy_for(tool_name) == "deny"
