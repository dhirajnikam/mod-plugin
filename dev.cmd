@echo off
rem Starts Claude Code in this repo with the cockpit mod loaded; saving a file under cockpit\hooks reloads it.
cd /d "%~dp0"
claude --plugin-dir "%~dp0cockpit" %*
