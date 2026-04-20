# Forge

Self-hosted local web UI that lets you drive Claude or OpenAI coding agents
from a browser, with your own pasted API key. Every session is scoped to a
folder on disk. The agent can read/write files, run bash, search the web,
spawn Explore subagents, and ask you clarifying questions — all shown live
in the conversation.

Not a SaaS. Runs as a native Python process on your machine.

## Features

- **Three providers, multiple models** — Claude (opus / sonnet / haiku 4.x),
  OpenAI (gpt-5, gpt-4.1, gpt-5-mini), and Google Gemini (3.x preview +
  2.5 stable tiers). Pick per session; **switch the model mid-session**
  from the header dropdown.
- **17 local tools** — Bash, Read/Write/Edit, Glob/Grep, NotebookEdit,
  WebFetch/WebSearch, a TaskCreate/Get/Update/List todo system,
  Task/TaskStop/TaskOutput for Explore subagents, AskUserQuestion.
- **Transparent tool calls** — every tool call is rendered inline with its
  input and output; nothing is hidden.
- **Markdown-rendered assistant replies** — fenced code with syntax
  highlighting, tables, lists via `react-markdown` + `rehype-highlight`.
- **Attachments** — drag *or paste* images directly into the prompt box;
  text files are inlined as fenced blocks. Claude / OpenAI / Gemini all
  see them.
- **Context meter + one-click compaction** — the header shows live
  input-token usage against the model's context window. Hit ~80 % and the
  Compact button highlights; click it to summarize the conversation so far
  and keep going without truncation.
- **Homepage landing view** — recent sessions with per-card context-usage
  bars, search, and folder / model filters.
- **Multiple parallel sessions** — each session has its own conversation
  history + folder; switch between them in the sidebar.
- **Streaming** — assistant text and thinking blocks stream token-by-token.
- **Interrupt** a running turn with a Stop button; history persists.
- **SQLite storage with restart-safe conversations** — single `app.db`
  file under `~/.forge/`; on restart the in-memory history is rehydrated
  from the event log, so you can keep talking to any session after
  `forge stop` / `forge`.
- **Dark UI** — sidebar-driven, inspired by Claude Code Desktop.

## Install

```bash
pipx install forge-agent
forge
```

`forge` starts the server in the **background** and returns the prompt.
Open <http://127.0.0.1:47821> in your browser whenever you want. The
SQLite DB, pasted API keys, PID file, and server log all live under
`~/.forge/`. Any path on your filesystem that your user can read is a
valid session folder — no bind-mounts, no jail.

### Commands

```
forge                  # start in background (default)
forge --browser        # start and open the UI in your default browser
forge --foreground     # start attached to this terminal (for debugging)
forge stop             # stop the background process
forge status           # check whether it's running
```

### Flags

```
forge --host 127.0.0.1   # bind host (default: 127.0.0.1)
forge --port 47821       # port     (default: 47821)
forge --data-dir ~/.forge
```

## First-time use

1. Open **Settings** in the sidebar, paste an Anthropic, OpenAI, or Google
   Gemini API key (or all three). Keys are stored in `~/.forge/app.db`.
2. Click **+ New session**, pick a provider + model, choose a folder, create.
3. Type a prompt. Tool calls render inline as collapsible cards.

## Tech stack

- Backend: Python 3.10+, FastAPI, WebSockets, SQLite via `sqlite3` stdlib
- LLM SDKs: `anthropic` + `openai` + `google-genai` Python clients (direct, no CLIs)
- Frontend: React 18, Vite, TypeScript, inline styles + a small theme module
- Markdown rendering: `react-markdown` + `remark-gfm` + `rehype-highlight` + `highlight.js`
- Extra deps: `httpx` (WebFetch + WebSearch), `markdownify` (HTML → md)

## Develop

Two terminals — frontend and backend run separately during development so
you get Vite HMR and FastAPI autoreload.

**Prerequisites:** Python ≥ 3.10, Node.js ≥ 18, npm.

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 47822
```

```bash
# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open <http://localhost:47821> — the Vite dev server proxies `/api/*` and
`/ws/sessions/*` to the backend on port 47822.

> Ports chosen to avoid the usual `5173`/`8000` collisions. If you change
> them, update three places: `frontend/vite.config.ts` (`server.port` +
> the two proxy targets), the default in `backend/app/cli.py`, and your
> `uvicorn --port` flag.

## Build a release wheel locally

```bash
scripts/build-wheel.sh
```

Bundles the frontend (`npm run build`), copies `frontend/dist/` into
`backend/app/static/`, then runs `python -m build`. Artifacts land in
`./dist/`:

```
dist/forge_agent-<version>-py3-none-any.whl
dist/forge_agent-<version>.tar.gz
```

Install the wheel locally to smoke-test it:

```bash
pipx install --force dist/forge_agent-*.whl
forge
```

## Release to PyPI (GitHub Actions)

Two separate workflows, each using PyPI
[Trusted Publishers](https://docs.pypi.org/trusted-publishers/) (OIDC).
No API tokens stored anywhere.

| Workflow | File | Trigger | Target |
|---|---|---|---|
| Release (PyPI) | `release.yml` | GitHub Release published | PyPI (wheel also attached to the Release) |
| Release (TestPyPI) | `release-testpypi.yml` | manual dispatch | TestPyPI (dry-run) |

**One-time setup:**

1. On <https://pypi.org> → *Manage → Publishing → Add a pending publisher*:
   - Owner / Repository: your GitHub repo
   - Workflow file: `release.yml`
   - Environment: `pypi`
2. Same on <https://test.pypi.org>:
   - Workflow file: `release-testpypi.yml`
   - Environment: `testpypi`
3. GitHub repo → *Settings → Environments* → create `pypi` and `testpypi`
   (optionally require a manual approval on `pypi`).

**Cut a real release:**

1. Bump `version` in `pyproject.toml`, commit, push.
2. On GitHub → *Releases → Draft a new release* (or `gh release create v0.1.2 --generate-notes`).
3. Click *Publish release*.

The workflow fires on the `release: published` event. It builds the
wheel, publishes to PyPI, and uploads the wheel + sdist as assets on
the release. A tag/pyproject version mismatch fails the build; a
pre-release version (e.g. `0.1.2.dev1`) is also rejected here — those
go through the TestPyPI workflow instead.

**Dry-run to TestPyPI:**

GitHub repo → *Actions → Release (TestPyPI) → Run workflow*:

1. **Use workflow from:** pick any branch.
2. **Pre-release suffix:** type `.dev1`, `a1`, `b2`, `rc1`, etc.

The workflow combines the base version from `pyproject.toml` on that
branch with your suffix at runtime — no commit needed, no pyproject
edit, nothing polluting git history.

```
pyproject says:  0.1.2         +  suffix  .dev1   →  uploads 0.1.2.dev1
pyproject says:  0.1.2.dev5    +  suffix  rc1     →  uploads 0.1.2rc1
                 (any existing pre-release is stripped first)
```

Every dispatch needs a new suffix since TestPyPI versions are
immutable. When you're ready for a real release, make sure
`pyproject.toml` is on a clean version (e.g. `0.1.2`), publish a
GitHub Release with tag `v0.1.2` — the PyPI workflow takes it from
there and rejects any pre-release version symmetrically.

`pipx install forge-agent` skips pre-releases by default, so end users
on real PyPI never pull a `.dev` wheel.

**Install a TestPyPI pre-release locally to smoke-test:**

```bash
pipx install \
  --index-url https://pypi.org/simple/ \
  --pip-args="--extra-index-url https://test.pypi.org/simple/ --pre --only-binary=:all:" \
  forge-agent
```

The `--only-binary=:all:` flag is important: TestPyPI has an ancient
broken `fastapi` sdist squatter that pip will otherwise try to build
from source and fail on. Forcing binary-only makes pip skip it and
pull the real `fastapi` wheel from PyPI.

## Project layout

```
backend/
  app/
    llm/         # system prompts, provider adapters, agent + subagent loops
    tools/       # all 17 tool implementations (one file per family)
    store/       # SQLite data-access layer
    api/         # REST routers
    ws/          # WebSocket per session
    schemas/     # Pydantic models
    runtime.py   # SessionRuntime: in-memory history + subscribers + ask_user futures
    migrations.py
    db.py
    main.py      # FastAPI app; mounts app/static/ for the bundled frontend
    cli.py       # `forge` entry point
    static/      # built frontend (populated by scripts/build-wheel.sh; gitignored)
frontend/
  src/
    components/  # Sidebar, SessionView, MessageList, PromptInput, modals…
    api/         # rest.ts + ws.ts
    theme.ts
    App.tsx
scripts/
  build-wheel.sh
.github/workflows/
  release.yml    # tag-triggered PyPI publish (OIDC)
pyproject.toml
```

See `CONTEXT.md` for the architectural decisions and history.

## Not implemented

- OAuth login (paste-key only)
- PDF attachments
- o-series reasoning models (`o1`, `o3`) — need a different request shape
- Local / self-hosted LLMs (user-supplied `base_url`)
- `EnterPlanMode` / `ExitPlanMode` / `Skill` tools
- Per-tool approval modal (all tools currently auto-allow)

## License

MIT. Use at your own risk.
