# Changelog

All notable changes to Cockpit are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- An icon (`cockpit/.claude-plugin/icon.png`): the Overview's progress ring in the Black theme's gold.
- CI on every push and pull request: the tests, validation and the link check.
- `docs/privacy.md` lists every model call Cockpit makes, what it sends and how to turn it off; a check in CI fails
  when a call goes undocumented.
- An architecture guide for contributors (`docs/architecture.md`).
- A short README for newcomers, with the details moved to `docs/`, one page per tab and topic.

### Changed
- An agent's result shows once, on its Finished row ("3/3 passed", its report); its Team row says what the expert
  does and points to the run ("done ↓").
- Empty lists are worded alike: the Rules tab's hooks and permission rules say "None yet." as its instructions do.
- A skipped flow step is marked ↷ and dimmed, with a "↷ skipped" legend, instead of struck through as if deleted.
- The pane's header is one line: the folder, branch, judges' mode, theme and the run badge beside the name. The
  Overview no longer repeats the running turn's time under its ring; it shows the last turn's once it ends.
- The source is split for newcomers: the pane in `hooks/tabs/`, one file per tab, and what Cockpit does in
  `hooks/ops/`, one file per concern; no source file is over 900 lines.
- Everything Cockpit draws outside the tabs (the band, the spinner, the chat's cards, the pane's frame) moved from
  `register.tsx` to `hooks/drawings.tsx`, leaving `register.tsx` at 559 lines.

### Fixed
- The Overview's checks say what each mark counts ("✓ 3 passed · more running" instead of "✓3 running"), and a
  failure is marked ✗ everywhere.
- The Activity tab no longer says "No files found here yet" over a feed of agents' events, and the feed's count
  is of the rows it shows ("6 events · 3 agents").
- The judges no longer answer a question about what only you can do ("Will you…", "Can you…", "Could you…"):
  it comes to you.
- ui-template validates cleanly: its manifest names its author, licence and repository, and a failed model lookup
  keeps the last model name instead of failing the hook.
- Slow presses no longer run past Claude Code's 10 s budget for a press: Push, Pull, Commit, Add token, Map
  again, Create agent and Compact return at once and run on in the background, named in the pane's header
  ("⟳ Pushing"), one of each at a time.
- Cockpit's auto-commit and a Commit you press share one lock, so two commits never run on the same files at once;
  a press while one runs says "still running".
- End-to-end tests no longer time out when the machine is busy: every test that takes over 300 ms on a quiet
  machine has 20 s, the rest keep the 5 s default so a real hang still fails fast.
- A GitHub token typed into the account box but not added is dropped when the box closes, instead of staying in the
  session's state.

## [0.5.0] - 2026-11-01

### Added
- **Rules tab**: see, add, edit and delete the hooks, permission rules and `CLAUDE.md` instructions of the repository
  or of you everywhere, with each change written back and the rest of the file kept.
- **Autopilot**: `/cockpit autopilot [$budget] [hours h] <goal>` works on a goal cycle after cycle from a roadmap until
  the judges agree it is done, with an optional budget and time limit, and pauses for you on what it must not decide.
- **Agent memory**: earlier agent runs on a similar task are remembered; experts' briefs carry what they found.
- **Neural view** in the Overview: the task, the agents at work on it with their progress, and what is remembered.
- **Connections** in the Agents tab: who started each agent (you, Claude, a pipeline, another agent), and agents from
  outside Cockpit marked.
- **Trackers**: each subagent's own task list shows as its progress, in the Overview, the Agents tab and the pipeline card.
- **Feature map** in the Activity tab: the codebase's features as a diagram, with what is being worked on lit.
- **Checks** in the Overview: the current flow's last failed tool call and the testers' latest count.
- **Changed files** card in the Overview.
- Flows for every turn: `/goal` turns, continuations and prompts another plugin intercepted now show progress.
- Community files: contributing guide, code of conduct, security policy, issue and pull request templates, and a
  link checker (`scripts/check_links.py`).

### Changed
- The Overview is one calm column: one heading style, folded sections, no repeated figures.
- The Agents tab shows each run in one place: Running, the team as a launcher, Finished folded, Settings folded.
- The experts keep a task list, never commit, push or switch branches, and the testers leave no throwaway files.
- The judges leave to you preference questions, choices between things you asked for, and replies that need your
  own words; a judge whose reply names no option abstains instead of voting for the first one.

### Fixed
- A shell command's edits now count in a flow's +/−.
- A task-list call that fails no longer leaves a ghost task.
- A subagent's first task list is kept when it arrives before the agent is recorded.

## [0.4.1] - 2026-10-30

### Changed
- Commit messages are written from the diff; GitHub accounts are really added and removed with gh.

## [0.4.0] and earlier

See the git history.

[Unreleased]: https://github.com/dhirajnikam/mod-plugin/commits/main
[0.5.0]: https://github.com/dhirajnikam/mod-plugin/commits/main
[0.4.1]: https://github.com/dhirajnikam/mod-plugin/commit/98c45bd
