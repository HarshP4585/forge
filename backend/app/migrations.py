"""Schema migrations.

To add a migration, append a new ``(version, [statements])`` tuple with the
next contiguous version number. Each entry runs inside its own transaction
(see ``db.migrate``). Never edit a migration that has already shipped —
write a new one instead.
"""

MIGRATIONS: list[tuple[int, list[str]]] = [
    (
        1,
        [
            """
            CREATE TABLE credentials (
                agent_kind   TEXT PRIMARY KEY,
                api_key      TEXT NOT NULL,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE sessions (
                id              TEXT PRIMARY KEY,
                agent_kind      TEXT NOT NULL,
                folder_path     TEXT NOT NULL,
                title           TEXT NOT NULL,
                status          TEXT NOT NULL,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                last_active_at  TEXT NOT NULL,
                extras          TEXT NOT NULL DEFAULT '{}'
            )
            """,
            "CREATE INDEX idx_sessions_last_active ON sessions(last_active_at DESC)",
            """
            CREATE TABLE messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                seq         INTEGER NOT NULL,
                created_at  TEXT NOT NULL,
                event       TEXT NOT NULL
            )
            """,
            "CREATE INDEX idx_messages_session_seq ON messages(session_id, seq)",
        ],
    ),
    # Rename the old agent_kind 'codex' to 'openai' after the codex→openai
    # pivot. Affects both the credentials PK row and any existing sessions.
    (
        2,
        [
            "UPDATE credentials SET agent_kind = 'openai' WHERE agent_kind = 'codex'",
            "UPDATE sessions SET agent_kind = 'openai' WHERE agent_kind = 'codex'",
        ],
    ),
    # Sessions now store the selected model id (per-model picker added).
    (
        3,
        [
            "ALTER TABLE sessions ADD COLUMN model TEXT NOT NULL DEFAULT ''",
        ],
    ),
]
