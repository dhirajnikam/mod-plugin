# Cockpit

A Claude Code mod that shows what a session is doing and gives you its controls, around the prompt and in a side pane. It is built from the "Powerhouse Mod v2" design.

## Install

Requires Claude Code 2.1.275 or later. At the prompt of a Claude Code session, type:

```
/plugin install cockpit --marketplace dhirajnikam/mod-plugin
```

Answer `y` to add this repository as a marketplace, then pick a scope: for you everywhere, or for one project. Cockpit loads at once; `/cockpit` opens its pane. Later versions arrive with `claude plugin update cockpit`.

**Good to know before you turn it on**

- Cockpit writes a `.cockpit/` folder at the top of each repository you use it in: its codebase memory and history. The folder carries its own `.gitignore`, so nothing in it is ever committed.
- Testing each agent's work is on: every agent run that edits files starts two more subagents (a positive and a negative tester). Switch it off in the Agents tab.
- Each prompt makes one small model call to write its own flow steps, and the judges make a few for each question Claude asks you (turn them off with `/cockpit mode off`).
- Push, pull requests and Verify after each turn are off until you turn them on.
- Plugins your organization manages may run before Cockpit and skip some of its hooks; Cockpit's other parts keep working.

## What it adds

- **Side pane** (`/cockpit`) with five tabs:
  - **Overview**: the current flow (a progress ring, the task, elapsed, changes, cost, step chips), then every prompt of the session as a flow with its state, time, steps, progress, changes and commit, and the session's totals (before the first prompt, the predefined flows); the context-window breakdown, a "Needs you" card, and a log of Claude's decisions with each judge's vote.
  - **Activity**: what is happening, live. A header with the current action, a turning glyph and a light running along a bar while work runs; the project's folder structure as a tree (git's view of it, ignored files left out), every file the session touched marked with its last operation's glyph and figures, the one being worked on right now marked `▶ … now` and pulsing, folders with nothing touched folded away until pressed; and under it the feed, newest first: every file read, written, edited, deleted or searched (its diff a press away) and what each agent is doing, each line with its age. Pressing a file narrows the feed to it.
  - **Agents**: the Build, Verify and Review pipelines and **+ New agent** in one row; a running pipeline as a strip of its experts' icons, the current one turning, with the hand-off it carries; the **team**, one row per agent: an icon (a line icon in a tinted tile on desktop, coloured by state, an arc turning round it while it runs and a ✓ or ✗ badge when it finishes; a glyph that spins on the terminal), its name, one line of what it is doing now, its report or what it is for, and ▶ to run it or ■ to stop it; and the **runs**, once there are any: each run's state, tool calls and time, its failing test cases in view, and a press opens its cases, report, recent steps and transcript. The experts (`cockpit:planner`, `builder`, `reviewer`, `prover`, `breaker`, `scribe`) ship with the mod and work in turn: each is handed the task and the REPORT and HANDOFF lines of the experts before it. Verify runs the Prover (proves the change works) then the Breaker (tries to break it); their CASE lines show on their rows and as `tests ✓n/m` in the band. **Every agent is tested by two testers**: when an agent's run edits or writes a file (an expert, an agent you made, or one Claude started), the positive tester (the Prover) proves it works, then the negative tester (the Breaker) tries to break it, both briefed with what that agent was asked and reported; the agent's row shows `+ positive 3/3   − negative 3/4`, and the testers' runs say whose work they test. A run that changed nothing gets a **± Test** button instead. Pipeline steps are left to their pipeline (Build already ends in both testers), and **Test each agent's work** under the list turns the automatic testing off. **+ New agent** makes an agent from a plain description: a model writes its definition (name, when to use it, tools, instructions), Cockpit registers it as `cockpit:<name>` and keeps it for later sessions, and it joins the team board with a ▶ like the experts. The engine dispatches a newly registered type from the next turn on, so if ▶ right after making one says the type is unknown, send any prompt first. The same form can also run a one-off task with any agent type. The experts (`cockpit:planner`, `builder`, `reviewer`, `prover`, `breaker`, `scribe`) ship with the mod and work in turn: each is handed the task and the REPORT and HANDOFF lines of the experts before it. Verify runs the Prover (proves the change works) then the Breaker (tries to break it); their CASE lines show on their cards and as `tests ✓n/m` in the band. The form lists every agent type it finds: the built-ins, the experts, `.claude/agents/*.md` in the project and in `~/.claude`, each installed plugin's agents as `plugin:name`, and any type that has started this session; any other name can be typed in.
  - **Git**: the branch with what is unpushed and unpulled, and **↓ Pull** and **↑ Push** buttons only when there is something to pull or push; the next commit as a card (type, message, branch, files, Commit) and the changes with their kind (new, deleted, renamed, edited) and ticks, only while there are changes (a clean tree says so in one line, and Commit shows only with a file ticked); the **history as a git graph** of every branch, remote and tag: each commit a dot on its lane, lines carrying the lanes down, a merge opening a lane and a branch joining one, each lane its own colour; refs as chips on their commit (HEAD's branch filled, local branches tinted, remotes ☁ and tags ⌑), unpushed commits hollow, Cockpit's own marked ✦, and a press opens a commit's author, date, message and changed files. Desktop draws the graph as SVG, the terminal with line characters. The account, patterns and options are folded away.
- **Above the prompt**: Progress and Context bars. Click either one to open Overview.
- **Spinner**: `✻ Editing login.ts … 1:23`. The desktop app keeps its own row and shows Cockpit's words in it.
- **Under the prompt** (terminal only): `[cockpit] ⎇ branch ↑ahead @account +add −del tests $cost mode`.
- **In the chat**: your prompts as `›` rows, Claude's replies with a `●`, and tool activity as cards (file edits, searches, judge votes, subagents, commits) that open the matching tab when clicked. The latest turn ends with `✻ Done · ready to commit … Done in m:ss`. A running pipeline shows its step above the prompt.

## Flows

Every prompt opens a flow, and its steps come from the work itself, in this order:

- **Claude's task list, when it keeps one.** As soon as Claude writes a plan (this app's task list, TodoWrite, or TaskCreate and TaskUpdate), the flow's steps are its tasks, each with the status Claude gave it, updated live as tasks are added, started, finished or ticked off at the turn's end. An update to a task from an earlier prompt's plan carries that plan over.
- **Steps written for the task.** Otherwise a quick model writes three to six steps for this prompt, specific to it ("Read the limiter code", "Add the rate limit", "Run the tests"), in the background so the prompt is not held. Each is tagged with the kind of work that reaches it (exploring, deciding, editing, testing, committing, answering), so tool calls move it.
- **A template, until then.** While the steps are being written, or if they cannot be: **Build** (Understand › Explore › Implement › Verify › Commit), **Docs** (no Verify), **Check** (Understand › Explore › Verify › Answer) or **Answer** (Understand › Explore › Answer), picked from the words of the prompt, with any step reached beyond it added. These five words are Cockpit's generic phases; they show only when there is nothing better.

**Progress** is `(steps done + ½ × steps in progress) ÷ steps that count`, rounded. On a task list, done and in progress are the tasks' own statuses. On written steps or a template, the step furthest reached is in progress while the turn runs and done once it ends; a step before it is done if its kind of work happened, and **skipped** (struck through, left out of the count) if it did not. Before the first prompt there is no task, so progress is 0%, Ready, even if you start a pipeline by hand. The Overview shows the sum under the step chips, for example `2 of 4 steps done (1 skipped, not counted) = 50%`. The ring, the chips, the band's Progress bar and each flow's row all use it. On the terminal the ring is drawn in braille dots; on desktop it is SVG.

`/cockpit flow <plan|task|build|docs|check|answer>`, or the **Flow** picker under the step chips, puts the current prompt on another flow; the choice stands.

## Codebase memory

At each session start Cockpit maps the repository from its imports (TypeScript, JavaScript, Dart, CSS, Python and the like): every source file, the files it imports and the files that import it, grouped into **features** (folders, two levels deep) with the features each one uses and is used by. After every edit, Claude's or an agent's, and after a turn whose shell commands changed files, it reads that file again.

- **Activity** shows it: the **Impact** of the file chosen in the tree, or else the one edited last (what it uses, what imports it, and every file and feature a change to it reaches, to check), and with neither, the features and how they connect. ↻ maps the repository again.
- **Claude reads it** every turn, as a short section of its system prompt: the features, their files and links, so it knows what a change reaches before making it.
- **The testers get it**: each expert's brief lists the files that import the changed ones.
- **It is kept in the repository** as `.cockpit/memory.json` and a readable `.cockpit/MEMORY.md`.

Feature descriptions are the folders' names for now; a model-written line for each feature is a later step.

## What is kept, and where

- **In the repository**, in `.cockpit/` at its top folder: `history.json` (every finished flow and agent run, and Cockpit's commits, across sessions: the Overview lists earlier sessions, and each agent's last result outlasts the session) and the codebase memory. The folder has its own `.gitignore` of `*`, so none of it is committed, auto-commit included.
- **In Cockpit's own store**, across sessions and reloads: Focus, the theme, the decision mode, and the Agents settings; the Git settings and account, per repository; the agents you made.

## Live figures

Timers, bars and the context window redraw every second while a turn, a tester or an agent runs. While the pane is shown, the repository and the usage are read again every 15 seconds, so a commit made in a terminal shows up without a turn. Status colours (green, red, amber) are Claude Code's own theme colours, so they follow your theme.

## Focus

Focus is **on** by default, and what you choose is kept: across sessions, reloads and updates of the mod. While it is on, the chat shows only your prompts, Claude's replies and the activity line. Tool cards and the "Done in" lines are hidden (errors still show), the band above the prompt shrinks to one line, and the pane opens only when you ask with `/cockpit`. Switch it with the **◉ Focus** button on the band or `/cockpit focus [on|off]`.

## Colours

The **Auto** theme (the default) uses Claude Code's own theme colours, so it follows your light or dark theme on every surface, with a gold accent; status colours (green, red, amber) are the theme's too. Paper, White, Black, Solarized and Nord can be picked by hand.

## Git

The first time you open the Git tab in a repository it asks five things, once: the **account** that commits, the **branch pattern**, the **message pattern**, the **commit mode**, and **when**. **⚙ Setup** asks again; **Patterns & options** edits any of it. Everything is remembered per repository.

- **Commit mode**: *Auto-commit* commits by itself, after each turn that changed the repository's files however they were changed (Edit and Write, a shell command, a script) and after each agent run that changed files, then pushes when **Push after commit** is on; *Ask me* proposes each commit above the prompt and in the pane, with Commit and Skip; *Manual* commits only when you press the button.
- **Type and branch are chosen for you.** The commit type (feat, fix, docs, refactor, perf, test, chore) comes from the words of your prompt, or the files changed; the branch kind (feature, fix, docs, …) follows it. When the work sits on a base branch (main, master, develop, trunk) a branch is cut by the pattern, e.g. `feature/add-login`; on any other branch the commit stays there. In Manual mode you pick the type.
- The message comes from the first line of your last prompt, or from the files changed; the Next commit card shows it before anything happens.
- **Commit** commits the ticked files only, even ones you had already staged with `git add`. A rename is committed whole.
- The tab reads the repository each time you open it (and after every turn); **↻ Refresh** reads it again.
- **Open pull request** needs a branch other than the base, which the pattern gives you.
- Failed pushes, PRs and commits say why in the toast.
- Git runs from the repository's top folder, and the settings and account are kept per repository, so a session working in a subfolder commits the right paths with the same settings.

## Git accounts

The **Account** box shows the saved login; **Modify** opens the choices and the ways to add one. It lists your global git identity and each GitHub login `gh auth status` reports. To add one, paste a personal access token (**Add token** runs `gh auth login --with-token`; gh keeps the token, Cockpit does not), or press **Log in with gh**: gh puts a one-time code on your clipboard and waits for you at github.com/login/device; press **↻ Detect** afterwards. Commits use the chosen account's name and email. With push on, Cockpit runs `gh auth switch` to that account's login first, which changes the active GitHub account for the whole machine. **Use for this repo** writes the identity into the repository's own git config.

## Web rendering

Where the surface draws SVG (the desktop app, the editor extension, mobile), the progress ring is the design's SVG ring. In a terminal it is drawn with coloured block characters instead, because terminals cannot draw HTML or SVG.

## Decisions by judges

Claude asks you things two ways: its question box in the middle of a turn, and the **next-step box** with reply buttons at the end of one. The judges take both. A quick model rates each decision from 0 to 10 for complexity: 0–3 gets 3 judges, 4–6 gets 6, 7–10 gets 9, each with its own point of view, and one option needs two thirds of the votes.

- **Auto · judge** (the default): a clear winner answers for you. A question gets that answer; a next step gets its winning reply sent as your next prompt, marked as the judges' choice in the chat. A decision that publishes, pushes, deletes, merges, sends or is otherwise hard to undo, a split, a button only you can press (an app action), and a fourth answer in a row with no prompt of yours in between all come to you, with what the judges recommend.
- **Ask me**: every decision is yours. The judges still vote and say what they recommend: above the prompt (⚖), in the chat for a next step, and in the Overview beside what you chose.
- **Off**: no judges and no model calls for them.

Switch in the Overview's Decisions card or with `/cockpit mode auto|ask|off`; the choice is kept across sessions.

## Commands

| Command | Does |
|---|---|
| `/cockpit` | open the pane |
| `/cockpit focus [on\|off]` | hide or show Claude's tool activity |
| `/cockpit theme <auto\|paper\|white\|black\|solarized\|nord>` | switch theme (or click the dots in the pane header) |
| `/cockpit mode <auto\|ask\|off>` | the judges decide, advise, or stay off |
| `/cockpit tab <overview\|files\|tests\|agents\|git>` | open a tab (`git` reads the repo again) |
| `/cockpit flow <plan\|task\|build\|docs\|check\|answer>` | put the current prompt on that flow (or pick it under the step chips) |
| `/cockpit test` | run the Verify pipeline now |

## Agents in auto mode

In auto permission mode the engine's classifier judges each subagent by the request to the model that asked for it. A press in the pane is no such request, so a start from the pane (▶, Start, Restart, a pipeline, `/cockpit test`, the testers after an agent's edit) can be refused with "no verdict". Cockpit handles that in two ways:

- Where it can, it puts the start to you in the permission dialog: approve it and the agent runs.
- Where that is refused anyway (a managed plugin that runs before Cockpit can stop the dialog), Cockpit **hands the start to Claude**: a short request in the conversation ("start the cockpit:prover agent with this brief"), so Claude starts the agent in that turn and auto mode judges it like any agent Claude starts. The agent shows in the Agents tab as usual, a waiting pipeline step takes it, and the hand-off opens no flow of its own.

A start your settings or permission mode already allow runs straight from the pane.

## Defaults that cost or publish

Push and PR creation are **off** until you turn them on in Git → Patterns & options. Running Verify after each turn that changes files is **off** too (Agents tab), because each run starts two subagents. Testing each agent's work is **on**: each agent run that changes files starts the two testers.

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
