# Privacy and cost

What Cockpit keeps, what it spends, and what it turns on by default. For everything it can run, write and send, see
the [security policy](../SECURITY.md).

## What is kept, and where

- **In the repository**, in `.cockpit/` at its top folder: `history.json` (every finished flow and agent run, and
  Cockpit's commits, across sessions), the codebase memory (`memory.json`, `MEMORY.md`), hand-off briefs, and the
  autopilot's roadmap. The folder has its own `.gitignore` of `*`, so none of it is committed, auto-commit included.
- **In Claude Code's plugin store**, across sessions: Focus, the theme, the judges' mode and the Agents settings; the
  Git settings and account, per repository; the agents you made. No token or password is stored.

## What costs, and what is on by default

- **On**: each prompt makes one small model call to write its flow steps; another writes the next commit message from
  the diff whenever the changed files shift; the judges make a few for each question or next step Claude asks you
  (`/cockpit mode off` turns them off); testing each agent's work starts two subagents after every agent run that
  changes files (off in the Agents tab).
- **Off until you turn it on**: push and pull requests (Git → Patterns & options), and Verify after each turn (Agents
  tab), because each run starts two subagents.
- **The autopilot** runs until it is done unless you give it a budget or a time limit; see [Autopilot](autopilot.md).

[All docs](README.md) · [Cockpit README](../README.md)
