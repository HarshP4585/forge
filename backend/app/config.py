import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent.parent

# Where the SQLite DB + any future on-disk state live. Defaults to ./data/
# next to the backend/ directory for local dev; override with DATA_DIR env
# var (e.g. when the `forge` CLI points it at the user's home).
DATA_DIR = Path(os.environ.get("DATA_DIR") or (ROOT_DIR / "data")).resolve()
DB_PATH = DATA_DIR / "app.db"
