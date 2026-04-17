import sqlite3
from contextlib import contextmanager
from collections.abc import Iterator

from app.config import DB_PATH
from app.migrations import MIGRATIONS


def _current_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def migrate(conn: sqlite3.Connection) -> None:
    current = _current_version(conn)
    for version, statements in MIGRATIONS:
        if version <= current:
            continue
        if version != current + 1:
            raise RuntimeError(
                f"migration gap: DB at v{current}, next pending is v{version} "
                f"(expected v{current + 1}) — check MIGRATIONS ordering"
            )
        # Explicit BEGIN/COMMIT because sqlite3's legacy transaction handling
        # (Python <3.12 default) does not auto-wrap DDL in a transaction.
        try:
            conn.execute("BEGIN")
            for stmt in statements:
                conn.execute(stmt)
            conn.execute(f"PRAGMA user_version = {int(version)}")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        current = version


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        migrate(conn)


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()
