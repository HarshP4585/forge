# Forge — Project Context

Self-hosted local web app that lets a single user drive multiple coding
agents (Claude + OpenAI) from one browser UI. Each session is scoped to a
folder on disk; the agent can read/write files, run bash, search, fetch
URLs, spawn Explore subagents, and ask the user clarifying questions.

Not a SaaS. Every user runs it on their own machine.

## Stack (current)

| Layer | Choice |
|---|---|
| Backend | Python 3.10+ + FastAPI + WebSockets |
| Data | SQLite (single file, `~/.forge/app.db` when installed; `./data/app.db` in dev) via `sqlite3` stdlib. Scalar columns + JSON columns; schema evolves via `PRAGMA user_version` migrations |
| Frontend | React 18 + Vite + TypeScript, dark theme. Built with `npm run build` → bundled into the Python wheel under `backend/app/static/`. |
| LLM SDKs | `anthropic` + `openai` Python clients — talking to each vendor directly. No `claude-agent-sdk`, no `codex` CLI, no OpenRouter. |
| Tool harness | 100% local Python implementations. One tool registry → schemas generated in both Anthropic and OpenAI formats. |
| Auth | User pastes API keys in Settings; stored in our SQLite `credentials` table |
| Packaging | Single PyPI wheel (`forge-agent`). One uvicorn process serves both the SPA and the API on one port. `forge` CLI daemonizes by default (PID + log under `~/.forge/`), with `forge stop` / `forge status`. |
| Release | Tag-triggered GitHub Actions workflow publishes to PyPI via Trusted Publishers (OIDC) — no stored secrets. |

## Architecture

- `backend/app/llm/` — prompts (embedded as Python strings), runtime context,
  provider adapters (Anthropic + OpenAI), agent tool loop, subagent runtime.
- `backend/app/tools/` — pure Python tool implementations + registry.
  Session context is injected via a `ContextVar` so tools like `Task` and
  `AskUserQuestion` can reach runtime state.
- `backend/app/runtime.py` — in-process `SessionRuntime` owning the
  conversation history, WS subscribers, pending question futures, and the
  turn task.
- `backend/app/ws/session_ws.py` — WebSocket per session; forwards
  `prompt.submit` / `interrupt` / `ask.answer` to the runtime and streams
  events back.
- `backend/app/api/*` — REST for credentials, sessions + messages, folder
  browse/validate, model list.
- `frontend/src/components/*` — sidebar-driven UI (no tabs), dark theme
  inspired by Claude Code Desktop.
- `backend/app/cli.py` — `forge` entry point. Default mode forks via
  `subprocess.Popen(..., start_new_session=True)`, writes PID to
  `~/.forge/forge.pid`, redirects stdio to `~/.forge/server.log`.
  `forge stop` reads the PID and sends SIGTERM (then SIGKILL after 5s).
- `backend/app/main.py` — in addition to the routers, mounts
  `backend/app/static/` (bundled frontend) when present. Dev mode skips
  the mount; Vite serves the SPA instead.

## Tool set (17 tools)

Registered in `backend/app/tools/__init__.py`. Scope determines availability.

| Tool | Main | Sub | Notes |
|---|:-:|:-:|---|
| Bash | ✓ | ✓ | subprocess, 120s default timeout |
| Glob | ✓ | ✓ | mtime-sorted |
| Grep | ✓ | ✓ | pure-Python regex, binary/size prefilters |
| Read | ✓ | ✓ | streaming line reader, .ipynb flattening, 10 MB cap |
| Edit | ✓ |  | unique-match-or-fail exact replacement |
| Write | ✓ |  | atomic overwrite |
| NotebookEdit | ✓ |  | replace/insert/delete .ipynb cells |
| WebFetch | ✓ | ✓ | HTML→markdown via markdownify, no LLM summarization step |
| WebSearch | ✓ | ✓ | DuckDuckGo HTML scrape via `httpx` + stdlib `html.parser` |
| TaskCreate/Get/Update/List | ✓ | ✓ | per-folder `.agent_todos.json`, asyncio.Lock for safety |
| Task | ✓ |  | spawn Explore subagent; noop-emit keeps internal tool calls out of parent UI |
| TaskStop / TaskOutput | ✓ |  | subagent lifecycle control |
| AskUserQuestion | ✓ |  | emits `ask.question` event; blocks on Future resolved by WS `ask.answer` |

Skipped (need more infra): `EnterPlanMode`, `ExitPlanMode`, `Skill`.

All file-touching tools run under `asyncio.to_thread` so parallel subagents
don't serialize behind each other on the event loop.

## Event shape (server → client)

`session.status`, `system.notice`, `message.user` (+ attachments),
`assistant.delta`/`.complete`, `assistant.thinking.delta`/`.complete`,
`tool.call.start`/`.result`, `usage`, `turn.done`, `error`,
`session.title`, `ask.question`.

## Event shape (client → server)

`prompt.submit` (text + attachments), `interrupt`, `ask.answer`,
`tool.approve` (reserved; auto-allow for now).

## Attachments

- Images (`image/*`) → base64 `image` blocks for Claude; `image_url` data
  URLs for OpenAI.
- Text files (code, logs, `.md`, etc.) → inlined as fenced code blocks
  with a filename header.
- 5 MB per file, 10 per message. PDFs and opaque binaries rejected
  client-side.
- Persisted in `messages.jsonl` only as `{kind, name}` metadata, not the
  raw payload — keeps SQLite rows small.

## Persistence details

- SQLite single file. Migrations: v1 base schema, v2 renames legacy
  `agent_kind='codex'` → `'openai'`, v3 adds `sessions.model` column.
- Every event is appended to `messages` table with a monotonic `seq` and
  `created_at`. Reloading a session replays this log in the UI.
- Conversation turn list (what the LLM actually sees) lives in-memory on
  `SessionRuntime` only — lost on backend restart. Session resume from
  disk is not yet implemented.
- Credentials stored in plain text. Acceptable for single-user local;
  encrypt-at-rest is a later upgrade.

## Decisions locked in

- **Direct vendor SDKs** — don't use Claude Code or Codex CLIs as a
  subprocess. Don't use OpenRouter.
- **Local tool registry shared across providers** — one implementation per
  tool, two schema adapters. Adding a tool means one file.
- **UI transparency** — every SDK event is surfaced; unknown events become
  `system.notice` rather than being dropped.
- **Sidebar-driven sessions, not tabs** — one active session at a time in
  the main pane; sidebar groups by folder basename.
- **Pasted API keys, not OAuth** — simpler; no proxy servers; no reliance
  on vendor login servers.
- **Multiple models per provider** — user picks the specific model when
  creating a session. Current picker: Claude (opus-4-7, sonnet-4-6,
  haiku-4-5), OpenAI (gpt-5, gpt-4.1, gpt-5-mini).

## Out of scope

- Hosted/multi-tenant deployment
- Docker/container packaging (tried; filesystem-jail friction made native
  PyPI install the better path — see *Pivots*)
- OAuth-based login flows
- Cross-restart conversation resume
- o-series reasoning models (`o1`, `o3`) — need per-model request shape
- Local LLMs / user-supplied `base_url`
- PDF attachments
- `EnterPlanMode` / `ExitPlanMode` / `Skill` tools
- MCP server config UI
- Slash commands

## Conversation log (summary)

Earlier turns covered initial scoping, storage choices, and the original
`claude-agent-sdk` integration plan. Key pivot points since then:

- **Persistence**: SQLite → JSON files → hybrid SQLite+JSON columns →
  settled. Migrations via `PRAGMA user_version`, not Alembic.
- **Python version**: upgraded from macOS system 3.9 to 3.12 to install
  `claude-agent-sdk` (then later dropped the SDK dependency entirely).
- **Unified tool harness**: dropped `claude-agent-sdk` + Node.js CLI
  requirement. Shared tool registry with per-vendor schema generators.
- **UI**: horizontal tabs → sidebar-driven sessions. Dark theme inspired
  by Claude Code Desktop.
- **Model picker**: multi-model per provider, user selects at session
  creation; stored in `sessions.model`.
- **Subagents**: `Task` tool (Explore-type), subagent's internal tool
  calls hidden from parent to save context.
- **AskUserQuestion**: round-trips through WS via pending Futures on the
  SessionRuntime.
- **Attachments**: images + text files; 5MB/10-file cap; persisted as
  metadata only.
- **OpenAI models**: gpt-5, gpt-4.1, gpt-5-mini — standard Chat
  Completions shape. o-series reasoning models deliberately excluded
  until we wire up their different request shape.
- **Deployment**: Docker → **PyPI**. Docker required a bind-mounted
  `./workspace` jail to give the container filesystem access, which
  hurt path portability and sent us chasing security workarounds. PyPI
  runs the backend as a native host process — any path the user can
  read is a valid session folder, no jail needed. Frontend is bundled
  into the wheel as `backend/app/static/`; one uvicorn process, one
  port, same-origin.
- **CLI**: `forge` detaches into the background by default with PID /
  log files under `~/.forge/`; foreground mode is opt-in via
  `--foreground` (useful for systemd or debugging). Browser is no
  longer opened automatically — opt in with `--browser`.
- **Release automation**: GitHub Actions `release.yml` triggered on
  `v*.*.*` tags. Uses PyPI Trusted Publishers (OIDC) so no long-lived
  API tokens live in GitHub Secrets. Manual `workflow_dispatch` path
  allows publishing to TestPyPI for dry-runs.
- **Distribution name**: `forge` was taken on PyPI → renamed to
  `forge-agent`. Import name stays `app`; CLI stays `forge`.
