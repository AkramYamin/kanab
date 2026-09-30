#!/usr/bin/env bash
# One-time setup for the announcer voice tool. Everything it downloads stays in
# this folder (tools/voice/): a private Python 3.11, the packages, and the AI
# models. Delete the folder's .venv/.python/.cache to remove it all again.
set -euo pipefail
cd "$(dirname "$0")"
export UV_PYTHON_INSTALL_DIR="$PWD/.python"
export UV_CACHE_DIR="$PWD/.cache/uv"

# uv (a Python installer) fetches Python 3.11 without touching the system.
if command -v uv >/dev/null 2>&1; then
  UV=uv
else
  if [ ! -x .bootstrap/bin/uv ]; then
    python3 -m venv .bootstrap
    .bootstrap/bin/pip install --quiet --disable-pip-version-check uv==0.12.18
  fi
  UV=.bootstrap/bin/uv
fi

"$UV" venv --python 3.11 --allow-existing .venv
"$UV" pip install --python .venv/bin/python -r requirements.txt
echo "Voice tool ready. Next: npm run voices"
