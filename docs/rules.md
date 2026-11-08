# Rules tab

The Rules tab shows the hooks, permission rules and instructions Claude Code follows, for **this repository** (`.claude/settings.json` and `CLAUDE.md`) or **you, everywhere** (`~/.claude/settings.json` and `~/.claude/CLAUDE.md`). Hooks with their event, matcher and command; permission rules as allow, ask or deny; instructions as the bullet lines of `CLAUDE.md`. Each row has ✎ to edit it in place and ✕ to delete it (after you confirm), each section **+ Add**. Every change reads the file again first and writes it back with the rest of it kept (a row that moved meanwhile is left alone); a settings file that is not valid JSON is shown read-only with the error, never overwritten. Hooks run shell commands: read one before you add it.

## MCP servers

The servers Claude Code would start here, each with its name, its kind (stdio, http, sse), what it runs (the command
and its arguments, or the URL) and whether it runs: **on**, **off** (switched off with `/mcp`, or listed in
`disabledMcpjsonServers`), or **needs approval** (a project server Claude Code will ask about before its first start).

- **This repository** shows the project's servers from `.mcp.json` (shared with everyone who works here), with ✎, ✕
  (after you confirm) and **+ Add** (a name, and a command with its arguments or a URL), and this project's own
  servers from `~/.claude.json`, marked *local, only you*, read only.
- **You, everywhere** shows your servers from the top of `~/.claude.json`, read only.
- `~/.claude.json` is Claude Code's own state file: Cockpit reads it and never writes it; change those servers with
  `claude mcp` or `/mcp`.
- A server's `env` and `headers` usually hold tokens: the tab shows their names (`secrets: GITHUB_TOKEN`), never their
  values, and an edit keeps them as they are in the file. Add them to `.mcp.json` by hand.
- `.mcp.json` is read again before each change and written back with the rest of it kept; one that is not valid JSON
  is shown read-only with the error, never overwritten.

![The Rules tab](images/rules.png)

[All docs](README.md) · [Project README](../README.md)
