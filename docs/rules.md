# Rules tab

the hooks, permission rules and instructions Claude Code follows, for **this repository** (`.claude/settings.json` and `CLAUDE.md`) or **you, everywhere** (`~/.claude/settings.json` and `~/.claude/CLAUDE.md`). Hooks with their event, matcher and command; permission rules as allow, ask or deny; instructions as the bullet lines of `CLAUDE.md`. Each row has ✎ to edit it in place and ✕ to delete it (after you confirm), each section **+ Add**. Every change reads the file again first and writes it back with the rest of it kept (a row that moved meanwhile is left alone); a settings file that is not valid JSON is shown read-only with the error, never overwritten. Hooks run shell commands: read one before you add it.

![The Rules tab](images/rules.png)

[All docs](README.md) · [Cockpit README](../README.md)
