#!/bin/zsh
SCRIPT_DIR=${0:A:h}
cd "$HOME/ORION" || exit 1
exec uv run python "$SCRIPT_DIR/web.py"
