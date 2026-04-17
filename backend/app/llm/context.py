"""Runtime environment context — the values that fill ${...}$ placeholders
in the agent system prompts."""

import platform as _platform
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict

LLM_LABELS = {
    "claude": "Claude",
    "openai": "OpenAI",
}


def _is_git_repo(folder: Path) -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(folder),
            capture_output=True,
            timeout=3,
        )
        return "Yes" if r.returncode == 0 else "No"
    except Exception:
        return "No"


def build(folder: Path, agent_kind: str, model: str) -> Dict[str, str]:
    return {
        "llm": LLM_LABELS.get(agent_kind, agent_kind),
        "model": model,
        "cwd": str(folder),
        "claude_md_path": str(folder / "CLAUDE.md"),
        "is_git": _is_git_repo(folder),
        "os_platform": _platform.system(),
        "os_version": _platform.release(),
        "today": datetime.now().strftime("%Y-%m-%d"),
    }
