#!/usr/bin/env bash
# Build the Forge wheel: bundle the frontend, copy it into the Python
# package, then run `python -m build`.
#
# Usage:  scripts/build-wheel.sh
# Output: dist/forge-<version>-py3-none-any.whl  (+ sdist)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STATIC_DIR="backend/app/static"

echo "==> building frontend bundle"
(cd frontend && npm install --no-audit --no-fund && npm run build)

echo "==> copying dist → $STATIC_DIR"
rm -rf "$STATIC_DIR"
mkdir -p "$STATIC_DIR"
cp -R frontend/dist/. "$STATIC_DIR/"

echo "==> building wheel"
python3 -m pip install --quiet --upgrade build
python3 -m build --wheel --sdist

echo
echo "done. Artifacts in ./dist/:"
ls -lh dist/
