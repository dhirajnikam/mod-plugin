# Overview tab

What the session is doing, at a glance, in one column. Every section opens with the same small capitalised heading,
with an arrow only where it folds.

![The Overview tab: a commit to confirm, the current flow, checks, the agents as a neural view, changed files and an earlier flow](images/overview.png)

*A preview drawn from the desktop pane; the app's own spacing differs slightly.*

## From top to bottom

- **Needs you**: the attention card, for a question Claude is waiting on or a commit Cockpit proposes (Commit, Skip).
- **Autopilot**, once one has started and until you clear it (×): its cycle (and for the product owner its round, vision and goals built), the milestones ticked, what the judges said is missing, the spend and the time, with ■ Stop and ▶ Resume.
  See [Autopilot](autopilot.md).
- **The current flow**: a progress ring, the task, the goal while one stands (`/goal`), the cost and, once a turn ends, how long it took (while it runs, the
  header's badge counts it), then the
  step chips with the flow they follow; pressing the flow's name opens the flow picker. See [Flows](flows.md).
- **Checks**, red while something fails: the current flow's last failed or refused tool call, and the testers'
  latest count with the first failing case.
- **Agents**, as a neural view: the task in the middle; above it every agent at work on it, Claude's and Cockpit's,
  joined by a line a signal runs along while it works, its ring filling with its own task list; below it, faint, the
  runs remembered from similar earlier tasks, each joined to the agent of its kind at work now; a tester joined to the
  agent whose work it tests. Hovering a node says what it is doing or found. In a terminal each agent is a tracker
  (a bar, done of all, the task it is on) and each memory a line. Its heading counts what finished this flow and
  what is remembered, with **Open Agents ›**. See [Agents](agents.md).
- **Changed files**: the first five, each with its kind beside it and its +/−, and Open Git.
- **Earlier flows**: the three newest (pressing one opens its details), the session's total on the heading. A flow's
  details offer **↶ Undo this turn**, which asks first (Undo / Keep), then puts back the files that turn changed,
  whatever changed them: Edit and Write, a shell command, a script, a subagent. See [Undoing a turn](#undoing-a-turn).
- **Context**: the percentage used, the bar, **Compact** (keeps a summary, as `/compact`) and **Clear** (starts the
  conversation afresh, as `/clear`, after you confirm); the tokens by kind are folded.
- **Decisions**: one line each, the question and what came of it; the judges' mode and rules are folded. See
  [Judges](judges.md).
- **Earlier sessions**, folded, with what the last 14 days cost on its heading. Opened: the spend of each of those days
  as a bar with its dollars, and the five costliest sessions with their date, length and turns. Each session's spend
  is kept in `.cockpit/history.json` at every turn's end and when the session ends: its start and last saved time, its
  dollars as Claude Code's `/cost` totals them, its context tokens at its last turn (Claude Code reports no running
  token total) and its turns. They are Claude Code's estimates, not a bill.
- **Daily budget ($)**, in the opened Earlier sessions (none until you set one; kept across sessions; **Clear** removes
  it): today's spend against it shows there and on the band above the prompt, amber from 80% and red from 100%, and
  crossing each sends one notice that day (shared by every session in the repository; a raised budget warns afresh),
  even while the pane is on screen and with finish notices off. Plain dollars only (10, 12.50). A session counts on
  the day it started, so one running past midnight adds to the day before. It only warns: nothing is ever stopped.

## Around the prompt and in the chat

- **Above the prompt**: Progress and Context bars; click either to open the Overview.
- **Spinner**: `✻ Editing login.ts … 1:23`. The desktop app keeps its own row and shows Cockpit's words in it.
- **Under the prompt** (terminal only): `[cockpit] ⎇ branch ↑ahead @account +add −del tests $cost mode`.
- **In the chat**: your prompts as `›` rows, Claude's replies with a `●`, and tool activity as cards (file edits,
  searches, judge votes, subagents, commits) that open the pane on the matching tab when clicked. A file card names the
  file by its folder and name; a subagent's card shows its tool calls and time while it runs, then what its tests found
  (`✓ 3/3 passed`, `✗ 1 failed · 2/3`). Each turn ends with a line saying what it came to:
  `✻ Done · ready to commit  ·  3 files +40 −12  ·  tests 3/3  ·  $0.21 … 0:10`.
- **The activity line** says what Claude is doing, and which of the task's steps it is on (`Implement 3/5`).
- **The band** names the agents at work (`⧉ 2 agents`) and the autopilot's cycle and spend, and offers **Compact** once
  the context is 80% full.

## Focus, colours and live figures

- **Focus** is on by default, and your choice is kept across sessions and updates. While it is on, the chat shows
  only your prompts, Claude's replies, the activity line and each turn's closing line; tool cards are hidden (errors
  still show), the band shrinks to one line, and the pane opens only when you ask with `/cockpit`. Switch it with **◉ Focus**
  on the band or `/cockpit focus [on|off]`.
- **Colours**: the **Auto** theme (the default) uses Claude Code's own theme colours, so it follows your light or dark
  theme, with a gold accent; the status colours (green, red, amber) are the theme's too. Paper, White, Black, Solarized and Nord can be picked by hand (the theme menu in the
  pane's header, or its mark in a terminal, which steps to the next; or `/cockpit theme <name>`).
- **Live figures**: timers, bars and the context window redraw every second while work runs. While the pane is shown,
  the repository and usage are read again every 15 seconds, so a commit made in a terminal shows up without a turn.
- **Drawing**: where the surface draws SVG (the desktop app, the editor extension, mobile), the ring, the maps and the
  icons are SVG; in a terminal they are drawn with characters.

## Undoing a turn

Before each turn starts (before Claude's first tool call) and after it ends, Cockpit keeps the whole working tree as a
snapshot: a commit under `refs/cockpit/turns/<n>/before` and `after` (`<n>` is the turn's id), built from a temporary index, so your working
tree, your staged changes and your branches are never touched. The newest 50 turns keep theirs.

- **Undo this turn** puts back what that turn changed: files it edited or deleted come back as they were before it,
  files it created are deleted (and folders that leaves empty), a file that became a folder or a folder a file is put
  back. Files the turn did not touch, staged or not, stay as they are.
- It refuses, naming them, when any of the turn's files changed after the turn ended, so later work is never written
  over. Your files just before the undo are kept as `refs/cockpit/turns/<n>/undone`; `git restore
  --source=refs/cockpit/turns/<n>/undone --worktree -- <path>` brings one back.
- Not covered: files your `.gitignore` leaves out (a build folder, `.env`), changes inside submodules, and a
  background agent that finishes after its turn ended (its changes land in the next turn). An undo after the turn was
  committed undoes the files only: the commit stays, and the undo shows as changes to commit.
- Snapshots copy untracked files that are not ignored into git's object store; the refs of older turns are dropped,
  and `git gc` reclaims the space as usual.


[All docs](README.md) · [Project README](../README.md)
