# Cockpit

A Claude Code mod that shows what a session is doing and gives you its controls, around the prompt and in a side pane. It is built from the "Powerhouse Mod v2" design.

## What it adds

- **Side pane** (`/cockpit`) with five tabs:
  - **Overview**: the current flow (a progress ring, the task, elapsed, changes, cost, step chips), then every prompt of the session as a flow with its state, time, steps, changes and commit, and the session's totals; the context-window breakdown, a "Needs you" card, and a log of Claude's decisions with each judge's vote.
  - **Activity**: what is happening, live. A header with the current action, a turning glyph and a light running along a bar while work runs; the files touched as a tree, the one being worked on right now marked `▶ … now` and pulsing, each file with its last operation's glyph and figures; and under it the feed, newest first: every file read, written, edited, deleted or searched (its diff a press away) and what each agent is doing, each line with its age. Pressing a file narrows the feed to it.
  - **Agents**: a team board of Cockpit's six experts, each card showing what that expert is doing right now (its latest tool call and elapsed time), its last result and REPORT line, with ▶ to run it and ■ to stop it; a pipeline strip (**Build**, **Verify**, **Review**) that shows the current step and the hand-off travelling to the next expert; and an activity list of every agent, with View, Stop and Restart, and a form to start any agent type. The experts (`cockpit:planner`, `builder`, `reviewer`, `prover`, `breaker`, `scribe`) ship with the mod and work in turn: each is handed the task and the REPORT and HANDOFF lines of the experts before it. Verify runs the Prover (proves the change works) then the Breaker (tries to break it); their CASE lines show on their cards and as `tests ✓n/m` in the band. The form lists every agent type it finds: the built-ins, the experts, `.claude/agents/*.md` in the project and in `~/.claude`, each installed plugin's agents as `plugin:name`, and any type that has started this session; any other name can be typed in.
  - **Git**: the branch with what is unpushed and a **↑ Push** button, the next commit as a card (type, message, branch, files, Commit), the changes with their kind (new, deleted, renamed, edited) and ticks, the repository's recent commits as a timeline with Cockpit's own annotated, and the account, patterns and options folded away.
- **Above the prompt**: Progress and Context bars. Click either one to open Overview.
- **Spinner**: `✻ Editing login.ts … 1:23`. The desktop app keeps its own row and shows Cockpit's words in it.
- **Under the prompt** (terminal only): `[cockpit] ⎇ branch ↑ahead @account +add −del tests $cost mode`.
- **In the chat**: your prompts as `›` rows, Claude's replies with a `●`, and tool activity as cards (file edits, searches, judge votes, subagents, commits) that open the matching tab when clicked. The latest turn ends with `✻ Done · ready to commit … Done in m:ss`. A running pipeline shows its step above the prompt.

## Live figures

Timers, bars and the context window redraw every second while a turn, a tester or an agent runs. While the pane is shown, the repository and the usage are read again every 15 seconds, so a commit made in a terminal shows up without a turn. Status colours (green, red, amber) are Claude Code's own theme colours, so they follow your theme.

## Focus

Focus is **on** by default. While it is on, the chat shows only your prompts, Claude's replies and the activity line. Tool cards and the "Done in" lines are hidden (errors still show), the band above the prompt shrinks to one line, and the pane opens only when you ask with `/cockpit`. Switch it with the **◉ Focus** button on the band or `/cockpit focus [on|off]`.

## Colours

The **Auto** theme (the default) uses Claude Code's own theme colours, so it follows your light or dark theme on every surface, with a gold accent; status colours (green, red, amber) are the theme's too. Paper, White, Black, Solarized and Nord can be picked by hand.

## Git

The first time you open the Git tab in a repository it asks five things, once: the **account** that commits, the **branch pattern**, the **message pattern**, the **commit mode**, and **when**. **⚙ Setup** asks again; **Patterns & options** edits any of it. Everything is remembered per repository.

- **Commit mode**: *Auto-commit* commits by itself; *Ask me* proposes each commit above the prompt and in the pane, with Commit and Skip; *Manual* commits only when you press the button.
- **Type and branch are chosen for you.** The commit type (feat, fix, docs, refactor, perf, test, chore) comes from the words of your prompt, or the files changed; the branch kind (feature, fix, docs, …) follows it. When the work sits on a base branch (main, master, develop, trunk) a branch is cut by the pattern, e.g. `feature/add-login`; on any other branch the commit stays there. In Manual mode you pick the type.
- The message comes from the first line of your last prompt, or from the files changed; the Next commit card shows it before anything happens.
- **Commit** commits the ticked files only, even ones you had already staged with `git add`. A rename is committed whole.
- The tab reads the repository each time you open it (and after every turn); **↻ Refresh** reads it again.
- **Open pull request** needs a branch other than the base, which the pattern gives you.
- Failed pushes, PRs and commits say why in the toast.

## Git accounts

The **Account** box shows the saved login; **Modify** opens the choices and the ways to add one. It lists your global git identity and each GitHub login `gh auth status` reports. To add one, paste a personal access token (**Add token** runs `gh auth login --with-token`; gh keeps the token, Cockpit does not), or press **Log in with gh**: gh puts a one-time code on your clipboard and waits for you at github.com/login/device; press **↻ Detect** afterwards. Commits use the chosen account's name and email. With push on, Cockpit runs `gh auth switch` to that account's login first, which changes the active GitHub account for the whole machine. **Use for this repo** writes the identity into the repository's own git config.

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
| `/cockpit test` | run the Verify pipeline now |

## Defaults that cost or publish

Push and PR creation are **off** until you turn them on in Git → Patterns & options. Running Verify after each turn that changes files is **off** too (Agents tab), because each run starts two subagents.

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
| `hooks/actions.ts` | git, judges, experts and pipelines, agents, measuring context |
| `agents/*.md` | the six experts: planner, builder, reviewer, prover, breaker, scribe |
| `hooks/logic.ts` | pure helpers: patterns, diffs, tree, progress, ring |
| `hooks/theme.ts` | the five themes |
| `hooks/state.ts` | initial state |
| `types/index.d.ts` | the state contract |
