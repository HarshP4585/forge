"""Entry point for the `forge` console script installed by pip.

By default, `forge` starts the server in the background and returns the
prompt to you. Use `forge stop` to stop it, `forge status` to check, and
`forge --foreground` to keep it attached (useful for debugging).
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


def _state_dir() -> Path:
    return (Path.home() / ".forge").resolve()


def _pid_file() -> Path:
    return _state_dir() / "forge.pid"


def _log_file() -> Path:
    return _state_dir() / "server.log"


def _pid_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    return True


def _read_pid() -> int | None:
    f = _pid_file()
    if not f.is_file():
        return None
    try:
        pid = int(f.read_text().strip())
    except (ValueError, OSError):
        return None
    if not _pid_is_alive(pid):
        # stale file from a previous crash; clean up so callers see a clean state
        f.unlink(missing_ok=True)
        return None
    return pid


def _ensure_static_bundle() -> None:
    static_dir = Path(__file__).parent / "static"
    if not (static_dir / "index.html").is_file():
        sys.stderr.write(
            "error: frontend bundle not found at "
            f"{static_dir}/index.html.\n"
            "This usually means you're running a source checkout without\n"
            "building the frontend. Run scripts/build-wheel.sh first, or use\n"
            "the dev workflow: `uvicorn app.main:app --reload` + `npm run dev`.\n"
        )
        sys.exit(1)


def _start(args: argparse.Namespace) -> None:
    data_dir = (args.data_dir or _state_dir()).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["DATA_DIR"] = str(data_dir)

    _ensure_static_bundle()

    existing = _read_pid()
    if existing is not None:
        print(
            f"forge: already running (pid {existing}). Use `forge stop` first.",
            file=sys.stderr,
        )
        sys.exit(1)

    url = f"http://{args.host}:{args.port}"

    if args.foreground:
        _run_server_foreground(args.host, args.port, url, data_dir)
        return

    # Detach: re-exec self with --foreground, with stdio redirected to a log
    # file and a new session so closing the terminal doesn't kill it.
    log_fh = open(_log_file(), "ab", buffering=0)
    cmd = [
        sys.executable,
        "-m",
        "app.cli",
        "--host",
        args.host,
        "--port",
        str(args.port),
        "--data-dir",
        str(data_dir),
        "--foreground",
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=log_fh,
        stderr=log_fh,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )

    # Give uvicorn ~1s to bind the port; if it fails we want to report now
    # rather than leaving a silent broken state.
    time.sleep(1.0)
    if proc.poll() is not None:
        sys.stderr.write(
            f"forge: failed to start (exit {proc.returncode}). "
            f"Check {_log_file()}.\n"
        )
        _pid_file().unlink(missing_ok=True)
        sys.exit(1)

    print(f"Forge running at {url}")
    print(f"  pid:  {proc.pid}")
    print(f"  data: {data_dir}")
    print(f"  log:  {_log_file()}")
    print("To stop: forge stop")

    if args.browser:
        webbrowser.open(url)


def _run_server_foreground(host: str, port: int, url: str, data_dir: Path) -> None:
    import uvicorn

    _pid_file().write_text(str(os.getpid()))
    try:
        print(f"Forge running at {url}  (data: {data_dir})", file=sys.stderr)
        uvicorn.run("app.main:app", host=host, port=port, log_level="info")
    finally:
        _pid_file().unlink(missing_ok=True)


def _stop(_args: argparse.Namespace) -> None:
    pid = _read_pid()
    if pid is None:
        print("forge: not running.")
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        _pid_file().unlink(missing_ok=True)
        print("forge: not running.")
        return

    # Wait up to ~5s for graceful exit, then SIGKILL
    for _ in range(50):
        if not _pid_is_alive(pid):
            break
        time.sleep(0.1)
    else:
        os.kill(pid, signal.SIGKILL)

    _pid_file().unlink(missing_ok=True)
    print(f"forge: stopped (pid {pid}).")


def _status(_args: argparse.Namespace) -> None:
    pid = _read_pid()
    if pid is None:
        print("forge: not running.")
        sys.exit(1)
    print(f"forge: running (pid {pid}).")
    print(f"  log: {_log_file()}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="forge",
        description="Run the Forge web UI locally.",
    )
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("stop", help="stop the running Forge").set_defaults(func=_stop)
    sub.add_parser("status", help="show whether Forge is running").set_defaults(func=_status)

    # Default (no subcommand) = start. Flags land on the top-level parser so
    # `forge --port 9000` works without writing `forge start --port 9000`.
    parser.add_argument("--host", default="127.0.0.1", help="bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=47821, help="port (default: 47821)")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="directory for the SQLite DB (default: ~/.forge)",
    )
    parser.add_argument(
        "--browser",
        action="store_true",
        help="open the UI in your default browser after start",
    )
    parser.add_argument(
        "--foreground",
        action="store_true",
        help="stay attached to this terminal (don't detach)",
    )

    args = parser.parse_args()

    if args.cmd is None:
        _start(args)
    else:
        args.func(args)


if __name__ == "__main__":
    main()
