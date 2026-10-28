#!/bin/sh
# Starts Claude Code in this repo with the cockpit mod loaded; saving a file under cockpit/hooks reloads it.
cd "$(dirname "$0")" && exec claude --plugin-dir "$PWD/cockpit" "$@"
