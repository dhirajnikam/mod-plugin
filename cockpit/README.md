# Cockpit

A Claude Code mod that shows what a session is doing and gives you its controls, around the prompt and in a side pane. It is built from the "Powerhouse Mod v2" design.

## What it adds

- **Side pane** (`/cockpit`) with five tabs:
  - **Overview**: a progress ring, step chips, the context-window breakdown, a "Needs you" card, and a log of Claude's decisions with each judge's vote.
  - **Files**: every file read, written, edited or deleted, as a folder tree or a timeline, with the changed lines.
  - **Tests**: a positive tester and a negative tester, run as two subagents.
  - **Agents**: every subagent, with View, Stop and Restart buttons and a form to start a new one.
  - **Git**: branch, commit type, scope and subject, a message preview, files to stage, auto-commit, and branch and message patterns.
- **Above the prompt**: Progress and Context bars. Click either one to open Overview.
- **Spinner**: `✻ Editing login.ts … 1:23`. The desktop app keeps its own row and shows Cockpit's words in it.
- **Under the prompt** (terminal only): `[cockpit] ⎇ branch ↑ahead @account +add −del tests $cost mode`.
- **In the chat**: your prompts as `›` rows, Claude's replies with a `●`, and tool activity as cards (file edits, searches, judge votes, subagents, commits) that open the matching tab when clicked. The latest turn ends with `✻ Done · ready to commit … Done in m:ss`. Tester results show as a card above the prompt.

## Focus

Focus is **on** by default. While it is on, the chat shows only your prompts, Claude's replies and the activity line. Tool cards and the "Done in" lines are hidden (errors still show), the band above the prompt shrinks to one line, and the pane opens only when you ask with `/cockpit`. Switch it with the **◉ Focus** button on the band or `/cockpit focus [on|off]`.

## Colours

The **Auto** theme (the default) follows Claude Code's own theme: White under a light theme, Black under a dark one, and it switches when you change `/config` → theme. Paper, White, Black, Solarized and Nord can be picked by hand.

## Git

- The tab reads the repository each time you open it (and after every turn); **↻ Refresh** reads it again.
- **Commit** commits the ticked files only, even ones you had already staged with `git add`. A rename is committed whole.
- With no subject typed, the first line of your last prompt is used; the preview shows the message before you commit.
- The branch is the one checked out unless you type another (Cockpit creates it) or pick a branch pattern. **Into** lists your local branches and starts on the repository's default.
- **Open pull request** needs a branch other than **Into**: type one or pick a branch pattern. Committing on the default branch itself pushes but opens no PR.
- Failed pushes, PRs and commits say why in the toast.
- Auto-commit runs **after tests pass** (it starts the testers itself) or **after each turn that changes files**.

## Git accounts

The Git tab's **Account** box lists your global git identity, each GitHub login `gh auth status` reports, and any account you add (label, name, email, GitHub login). Accounts you add are kept across sessions. Commits use the chosen account's name and email. With push on, Cockpit runs `gh auth switch` to that account's login first, which changes the active GitHub account for the whole machine. **Use for this repo** writes the identity into the repository's own git config.

## Web rendering

Where the surface draws SVG (the desktop app, the editor extension, mobile), the progress ring is the design's SVG ring. In a terminal it is drawn with coloured block characters instead, because terminals cannot draw HTML or SVG.

## Decisions by judges

In **Auto · judge** mode, a quick model rates each question Claude asks from 0 to 10 for complexity. Questions rated 0–3 get 3 judges, 4–6 get 6, and 7–10 get 9. If one option gets two thirds of the votes, it is answered for you. Otherwise the question comes to you as usual. In **Ask me** mode every question comes to you.

## Commands

| Command | Does |
|---|---|
| `/cockpit` | open the pane |
| `/cockpit focus [on\|off]` | hide or show Claude's tool activity |
| `/cockpit theme <auto\|paper\|white\|black\|solarized\|nord>` | switch theme (or click the dots in the pane header) |
| `/cockpit mode <auto\|ask>` | who answers Claude's questions |
| `/cockpit tab <overview\|files\|tests\|agents\|git>` | open a tab (`git` reads the repo again) |
| `/cockpit test` | run both testers now |

## Defaults that cost or publish

Push and PR creation are **off** until you turn them on in Git → Patterns & options. Running the testers after each turn that changes files is **off** too (Tests tab), because each run starts two subagents.

## Develop

```
./dev.sh        # macOS / Linux, from the repo root
dev.cmd         # Windows
```

Saving a file under `hooks/` reloads the mod when the turn ends. `claude plugin validate ./cockpit` checks it, `claude plugin test ./cockpit` runs the tests (renders on terminal and desktop, every width from 28 to 160 columns, the git flow). `hooks/logic.ts` has a `selfCheck()` that runs at session start and logs any failure.

| File | Holds |
|---|---|
| `hooks/register.tsx` | event hooks: prompt, tool calls, judges, turn end, the spinner, band and status row |
| `hooks/views.tsx` | the pane's header, tabs and five tab views |
| `hooks/actions.ts` | git, judges, testers, agents, measuring context |
| `hooks/logic.ts` | pure helpers: patterns, diffs, tree, progress, ring |
| `hooks/theme.ts` | the five themes |
| `hooks/state.ts` | initial state |
| `types/index.d.ts` | the state contract |
