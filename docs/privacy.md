# Privacy and cost

What Cockpit keeps, what it spends, and what it turns on by default. For everything it can run, write and send, see
the [security policy](../SECURITY.md).

## What is kept, and where

- **In the repository**, in `.cockpit/` at its top folder: `history.json` (every finished flow and agent run, and
  Cockpit's commits, across sessions), the codebase memory (`memory.json`, `MEMORY.md`), hand-off briefs, and the
  autopilot's roadmap. The folder has its own `.gitignore` of `*`, so none of it is committed, auto-commit included.
- **In Claude Code's plugin store**, across sessions: Focus, the theme, the judges' mode and the Agents settings; the
  Git settings and account, per repository; the agents you made. No token or password is stored: a token you paste
  goes straight to `gh auth login`, and one typed but not added is dropped when the account box closes.

## Every model call

Each is marked in the code with `// privacy: <id>`, and `scripts/check_privacy.py` (run in CI) fails if a model call
has no row here.

| Call | When | Model | What it sends | Turn it off |
|---|---|---|---|---|
| `flow-steps` | each prompt, in the background | Haiku | the prompt's text | (always on) |
| `commit-message` | when the files ticked for the next commit change | Haiku | the diff of the ticked files and the first 60 lines of each new file | (always on, in every commit mode) |
| `feature-names` | a session start that finds files added or removed | Sonnet | each source file's path, exports, first comment and imports | (always on) |
| `judge-complexity` | each question or next step Claude asks you | Haiku | the question and its options | `/cockpit mode off` |
| `judge-context` | each judged decision but the autopilot's | a fork of the session's model | the whole conversation so far, asked for a 120-word summary | `/cockpit mode off` |
| `judge-votes` | each judged decision, 3, 6 or 9 times | Haiku | that summary, the question and its options; for the autopilot's claim of done, the roadmap, the commits since it began, the uncommitted diffstat and the end of Claude's answer; for the product owner's next goal, the vision, the goals built and its study | `/cockpit mode off` |
| `agent-definition` | **+ New agent** | Sonnet | the description you typed | (only when you press it) |

## Every command it runs

`git` (status, diff, log, show, ls-files, rev-parse, branch, config; add, commit, switch, init; push and pull) and `gh`
(auth status, auth login, auth logout, auth switch, auth setup-git, api user, pr create). When each runs, and what it
changes on your machine, is in the [security policy](../SECURITY.md#what-cockpit-can-do-on-your-machine).

## What costs, and what is on by default

- **On**: each prompt makes one small model call to write its flow steps; another writes the next commit message from
  the diff whenever the changed files shift; the judges make a few for each question or next step Claude asks you
  (`/cockpit mode off` turns them off); testing each agent's work starts two subagents after every agent run that
  changes files (off in the Agents tab).
- **Off until you turn it on**: push and pull requests (Git → Patterns & options), and Verify after each turn (Agents
  tab), because each run starts two subagents.
- **The autopilot** runs until it is done unless you give it a budget or a time limit; see [Autopilot](autopilot.md).

[All docs](README.md) · [Project README](../README.md)
