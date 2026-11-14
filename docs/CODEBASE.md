# Codebase guide

A map of this repository for someone new to it. It is meant to be read, then improved: ask Claude to change any part
that is unclear or out of date. For the event-by-event detail, see [architecture.md](architecture.md); this guide
links to it rather than repeating it.

## 1. What the project is for

This repository ships **Cockpit**, a Claude Code *mod*: a plugin built from a hooks module that Claude Code loads and
calls on its events. Cockpit adds a side pane and a band around the prompt that show what a session is doing (each
task's progress, the agents at work, the files touched, git, what loads into every session) and gives you the controls
to act on it. On top of that it can:

- run **expert agents** (planner, builder, reviewer, prover, breaker, scribe) one after another as pipelines, and test
  any agent's change with two tester agents;
- let a **panel of model judges** answer Claude's questions in Auto mode, sending anything risky back to you;
- run an **autopilot** that works on a goal cycle after cycle until the judges agree it is done;
- write the commit from the diff, draw a git graph, watch the branch's pull request, and **undo a turn** whatever
  made its changes;
- keep a **codebase memory** (imports, features, impact) and add it to Claude's system prompt.

The user-facing description is the [project README](../README.md); each tab has its own page under [docs/](README.md).

## 2. How it is laid out

| Path | What it is |
|---|---|
| [cockpit/](../cockpit) | The plugin itself: everything that ships |
| [cockpit/.claude-plugin/plugin.json](../cockpit/.claude-plugin/plugin.json) | Plugin manifest: name, version, the path of the state types |
| [cockpit/hooks/hooks.json](../cockpit/hooks/hooks.json) | Tells Claude Code the hooks module is `register.tsx` |
| [cockpit/hooks/](../cockpit/hooks) | All the code (below) |
| [cockpit/agents/](../cockpit/agents) | The six experts, one Markdown file each (front matter: name, description, model; body: the prompt) |
| [cockpit/types/index.d.ts](../cockpit/types/index.d.ts) | The state contract: the `Ph` type and every value Cockpit keeps |
| [cockpit/tests/](../cockpit/tests) | Tests for Claude Code's test kit (`claude-code/testing`) |
| [scripts/](../scripts) | Python checks run in CI, and the docs-preview drawer |
| [docs/](README.md) | One page per tab and feature, plus [architecture.md](architecture.md), [privacy.md](privacy.md) and this guide |
| [.claude-plugin/marketplace.json](../.claude-plugin/marketplace.json) | Makes this repository a marketplace listing the one plugin, `cockpit` |
| [.github/workflows/ci.yml](../.github/workflows/ci.yml) | CI: the tests, validation and the Python checks |
| [design/](../design) | One file, `Powerhouse Mod v2.dc.html`: the visual design Cockpit was built from (themes, layout). Reference only; nothing loads it |
| [dev.sh](../dev.sh), [dev.cmd](../dev.cmd) | Start Claude Code with Cockpit loaded from this checkout |
| [CHANGELOG.md](../CHANGELOG.md) | Every change, under `[Unreleased]` until a release |

**There is no `plugins/` folder.** Cockpit was once split into `cockpit-core` plus one add-on per tab under
`plugins/`; commit `7c0ccc2` removed the split and ships Cockpit as one plugin. Traces remain: the `cockpit.set`,
`cockpit.act` and `cockpit.tab` events in `register.tsx` and `tabsAvailable` in the state exist so another plugin
can extend Cockpit.

Not tracked: `.cockpit/` (Cockpit's own per-repository data, which writes its own `.gitignore`), `node_modules/`, and
`cockpit/.claude-plugin/types/` (types Claude Code writes when it loads the mod).

### The modules in cockpit/hooks/

Cockpit's code laid out by feature: one folder per feature, holding its logic, its engine I/O and its tab.

**Entry and wiring**

- [register.tsx](../cockpit/hooks/register.tsx): the hooks module. Registers every event hook (`session.start`,
  `prompt.submit`, `turn.start`, `tool.call`, `turn.complete`, `agent.spawn`, …), the `/cockpit` command, the
  live-figure timers, and the extension events, in the order the engine runs them. It holds the per-turn bookkeeping
  (what changed since the prompt, the running flow) in closure variables; the work around each hook lives with its
  feature.
- [commands.ts](../cockpit/hooks/commands.ts): the `/cockpit` command and its sub-commands (`runCockpitCommand()`).
- [acts.ts](../cockpit/hooks/acts.ts): actions callable by name (`ACTS` and `act()`), for `cockpit.act`.
- [turn-io.ts](../cockpit/hooks/turn-io.ts): opening a flow for a prompt and closing it at the turn's end, calling each
  feature the turn reaches; Claude's task list as the flow's or an agent's plan (`trackPlan()`).

**The features, one folder each**

| Folder | What it holds |
|---|---|
| [core/](../cockpit/hooks/core) | [core.ts](../cockpit/hooks/core/core.ts): the state atom, `look()`, `set()` and `setUi()`, preferences, toasts and notes, and `claim`/`release`/`inBackground` for slow work. [state.ts](../cockpit/hooks/core/state.ts): `INITIAL`, the state's first value, and `PANE`, the pane's id. [repos.ts](../cockpit/hooks/core/repos.ts): `repoRoot()` (including picking a repo when the session folder holds several) and `git()`. [history.ts](../cockpit/hooks/core/history.ts), [spend.ts](../cockpit/hooks/core/spend.ts) (spend per session and per day, budget levels), [notify.ts](../cockpit/hooks/core/notify.ts) (one notice when a turn, agent or autopilot cycle finishes while you are not watching; the daily budget warning), [session.ts](../cockpit/hooks/core/session.ts) (measuring, compacting and clearing the context), [text.ts](../cockpit/hooks/core/text.ts) and [theme.ts](../cockpit/hooks/core/theme.ts) (the five palettes, reduced to the tokens a terminal draws with). [experts.ts](../cockpit/hooks/core/experts.ts): the experts table (one row per expert, with its icon and where its model choice starts) and the pipelines, read by every feature that shows or runs an expert |
| [flows/](../cockpit/hooks/flows) | [flows.ts](../cockpit/hooks/flows/flows.ts): the flows, their steps and progress. [tools.ts](../cockpit/hooks/flows/tools.ts): a tool call as a file operation and as a step. [flows-io.ts](../cockpit/hooks/flows/flows-io.ts): asking a model for a flow's steps |
| [git/](../cockpit/hooks/git) | [git.ts](../cockpit/hooks/git/git.ts): refreshing the repo, commit messages and commit modes, push. [git-form.ts](../cockpit/hooks/git/git-form.ts): branch and commit patterns. [graph.ts](../cockpit/hooks/git/graph.ts): the commit graph. [accounts.ts](../cockpit/hooks/git/accounts.ts): gh accounts. [pr.ts](../cockpit/hooks/git/pr.ts): the pull request and its checks. [turns.ts](../cockpit/hooks/git/turns.ts) and [turns-io.ts](../cockpit/hooks/git/turns-io.ts): turn snapshots and undo, the git commands as JSON data and running them. [git-tab.tsx](../cockpit/hooks/git/git-tab.tsx): the Git tab |
| [agents/](../cockpit/hooks/agents) | [agents.ts](../cockpit/hooks/agents/agents.ts): registering the experts, starting agents and pipelines, hand-offs to Claude, tracking and finishing agents, the testers. [pick.ts](../cockpit/hooks/agents/pick.ts): `pickRun()`, an agent's model, effort and helper count from its kind and task words. [worktrees.ts](../cockpit/hooks/agents/worktrees.ts) and [worktrees-io.ts](../cockpit/hooks/agents/worktrees-io.ts): agent worktrees, the git commands as JSON data (with `fillArgs()`) and running them. [agents-view.ts](../cockpit/hooks/agents/agents-view.ts): the agents as a diagram. [agents-tab.tsx](../cockpit/hooks/agents/agents-tab.tsx): the Agents tab |
| [judges/](../cockpit/hooks/judges) | [judges.ts](../cockpit/hooks/judges/judges.ts): how many judges sit and their tally. [decisions.ts](../cockpit/hooks/judges/decisions.ts): `judge()`, `judgeNext()` and the `RISKY`/`PERSONAL`/`OPEN` rules. [autopilot.ts](../cockpit/hooks/judges/autopilot.ts): the autopilot (start, stop, resume, `autopilotTurnEnd()`) |
| [memory/](../cockpit/hooks/memory) | [memory.ts](../cockpit/hooks/memory/memory.ts): imports, features (folders, or named by a model), impact of a change, `memoryText()` for the prompt, `adoptFiles()` (keeps the named features up with files that come or go, no model needed) and `memoryMarkdown()` (the index and a page per feature). [memory-map.ts](../cockpit/hooks/memory/memory-map.ts): the feature map. [memory-io.ts](../cockpit/hooks/memory/memory-io.ts): building the codebase memory (`buildMemory()`), updating it for one file (`updateMemory()`), checking it against git's file list (`syncMemory()`) and writing it to `.cockpit/`. [tree.ts](../cockpit/hooks/memory/tree.ts): the file tree. [explain.ts](../cockpit/hooks/memory/explain.ts): `/cockpit explain`, the prompt that asks Claude to write this guide, and the guide's row state. [activity-tab.tsx](../cockpit/hooks/memory/activity-tab.tsx): the Activity tab. [guide.tsx](../cockpit/hooks/memory/guide.tsx): the Overview's codebase-guide row |
| [rules/](../cockpit/hooks/rules) | [rules.ts](../cockpit/hooks/rules/rules.ts): reading and changing settings and `CLAUDE.md` text while keeping the rest of the file. [rules-io.ts](../cockpit/hooks/rules/rules-io.ts): reading and writing settings, `CLAUDE.md`, skills and MCP servers. [rules-tab.tsx](../cockpit/hooks/rules/rules-tab.tsx): the Rules tab |
| [pane/](../cockpit/hooks/pane) | [full-pane.tsx](../cockpit/hooks/pane/full-pane.tsx): the side pane (header, tabs, open tab) and what it draws with (`paneV()`: elements, state, theme, width). [header.tsx](../cockpit/hooks/pane/header.tsx): its header and tab row. [overview-tab.tsx](../cockpit/hooks/pane/overview-tab.tsx): the Overview tab. [tabs.ts](../cockpit/hooks/pane/tabs.ts): the one table of tabs (`TABS`, `isTab()`, `openTab()`) |
| [ui/](../cockpit/hooks/ui) | [shared.tsx](../cockpit/hooks/ui/shared.tsx): the pieces the tabs share and `sp()` spacing. [svg.ts](../cockpit/hooks/ui/svg.ts): the SVG drawings (the ring, the agents view). It imports only `core/` |
| [chat/](../cockpit/hooks/chat) | [drawings.tsx](../cockpit/hooks/chat/drawings.tsx): everything around the chat: the band above the prompt, the spinner's words, the line under the prompt, tool-use cards, and what Focus hides |

Where a feature has the pair, `x.ts` is its pure logic (testable without the engine) and `x-io.ts` its engine I/O;
`x-tab.tsx` is its tab in the pane.

## 3. How a request and the data flow through it

```
Claude Code event ──▶ register.tsx hook ──▶ next(e) (Claude Code carries on)
                             │
                             └──▶ a feature's action ──▶ git, gh, $.model, agents, files
                                        │
                                        ▼
                                   set(): the state atom ──▶ ui.render hooks redraw (the tabs, chat/drawings.tsx)
                                        ▲
         press in the pane ─────────────┘   (Button onPress calls an action from its feature's folder)
```

Every hook has the shape `($, e, next)`: `$` is the engine interface (files, processes, models, agents, clock,
store, UI), `e` the event, and `next(e)` runs what comes after Cockpit. Cockpit almost always calls `next(e)` and
records what happened; it rarely changes an event. Most hooks end in `.catch(($, e, next) => next(e))`, so a failure
in Cockpit never blocks the session.

**A prompt, end to end** (the hooks are in [register.tsx](../cockpit/hooks/register.tsx), the work where named):

1. `prompt.submit`: skips Cockpit's own hand-offs and commands; otherwise `openFlow()`
   ([turn-io.ts](../cockpit/hooks/turn-io.ts)) records a new flow and the repository's changes at that
   moment, then `writeSteps()` ([flows-io.ts](../cockpit/hooks/flows/flows-io.ts)) asks a model for the flow's
   steps in the background so the prompt is not held. `recall()` ([memory.ts](../cockpit/hooks/memory/memory.ts))
   attaches the features the prompt's words name, or that were worked on lately, beside the prompt, and
   `syncMemory()` catches files changed between turns. A prompt refused further down removes its flow again.
2. `turn.start`: a turn with no prompt of yours (a `/goal` continuation, a queued prompt) carries on the last flow
   or opens one. A snapshot of the working tree is taken before the turn (`snapTurn()` in
   [turns-io.ts](../cockpit/hooks/git/turns-io.ts)).
3. `prompt.compose`: adds the codebase memory (`memoryText()`, every feature on one line with its page) to
   Claude's system prompt.
4. `tool.call`: each call is recorded as a file operation and moves the flow's steps; `TodoWrite`, `TaskCreate`
   and `TaskUpdate` make Claude's task list the flow's steps; `AskUserQuestion` goes to `judge()`
   ([decisions.ts](../cockpit/hooks/judges/decisions.ts)).
5. `turn.complete`: `mainTurnEnd()` (`turn-io.ts`) closes the flow, refreshes the repo, takes the after-snapshot,
   measures context, syncs agents, lets the autopilot decide its next cycle, updates the memory for changed files
   (and, when the turn changed any, `syncMemory()` adds or drops the files a shell command made or removed that
   `git status` does not name one by one), sends a notice, starts Verify and/or `decideCommit()` depending on the Git settings, saves history and checks the daily budget.

**An agent** follows the same events with `e.agentId` set: started from the Agents tab (`runExpert`,
`startPipeline`, `spawnAgent` in [agents.ts](../cockpit/hooks/agents/agents.ts)) or by Claude's `Agent` tool;
`agent.spawn` records it; its `turn.complete` runs `finishAgent()` (reads its `CASE`, `REPORT` and `HANDOFF`
lines), `advancePipeline()` and `testAgent()`. A timer calls `syncAgents()` to catch agents Cockpit's hooks missed.

**Timers** set in `session.start`: a redraw every 400 ms while anything runs, `syncAgents()` every 2 s, and the repo,
PR, context and guide re-read every 15 s while the pane is shown.

**Where data lives**: the session's state in the atom; preferences, Git settings and accounts in Claude Code's plugin
store (`$.store`); history, hand-offs, roadmaps and the memory (`memory.json`, the index `MEMORY.md`, a page per feature in `memory/`)
in the repository's `.cockpit/`; turn snapshots under
`refs/cockpit/turns/`. See [architecture.md](architecture.md#what-is-kept-where) and [privacy.md](privacy.md).

## 4. Design decisions and the approach

- **Observe, don't intercept.** Hooks call `next(e)` and record; Cockpit changes an event only where it must (adding
  the memory section, a `tool.check` on `Agent`). Failures fall through to `next(e)`. Trade-off: it sees what the
  engine reports and no more, so some things are reconstructed (agents from the engine's list, a turn's changes from
  `git status` before and after).
- **One state atom, declared once.** All state is one value of type `Ph`. The engine lets an atom be used only in the
  file that declares it, so [core.ts](../cockpit/hooks/core/core.ts) is the one place: everything else reads
  with `look($)` and writes with `set($, patch)` or `setUi($, uiPatch)`. `set()` also saves the preferences (`PREFS`)
  that outlast a session. Drawings only read. When `Ph` changes shape, bump the `ph-26` tag in that file so an older
  stored value reads as `INITIAL`; new fields are optional so an older saved session still loads.
- **Module variables stay private to their file.** What a feature keeps between events (hand-offs on their way,
  worktrees waiting for their agent, notices already sent) is a module-level variable of the file that owns it,
  reached only through that file's functions. `claim()`/`release()` keep their `busy` map in the state instead,
  because the pane's header draws what is running. Slow work from a press runs through `inBackground()` since Claude
  Code drops a press that waits past 10 s.
- **Pure logic apart from engine I/O.** `flows.ts`, `tools.ts`, `git-form.ts`, `graph.ts`, `experts.ts`, `pick.ts`,
  `judges.ts`, `memory.ts`, `memory-map.ts`, `tree.ts`, `rules.ts`, `spend.ts`, `svg.ts` and the command data in
  `turns.ts`/`worktrees.ts` take values and return values, so tests exercise them directly.
- **Git commands as data, proven on real git.** The test kit cannot run processes, so the snapshot, undo and worktree
  commands are JSON between markers in [turns.ts](../cockpit/hooks/git/turns.ts) and
  [worktrees.ts](../cockpit/hooks/agents/worktrees.ts); [check_turn_undo.py](../scripts/check_turn_undo.py) and
  [check_worktrees.py](../scripts/check_worktrees.py) read those same lists and run them on a temporary repository,
  so the two cannot drift. Snapshots use a temporary index, so your index and branches are never touched.
- **Laid out by feature.** Each feature's logic, I/O and tab sit in one folder, so a change to a feature stays there.
  Where a feature has the pair, `x.ts` is pure and `x-io.ts` does its engine I/O (`flows`, `memory`, `rules`,
  `turns`, `worktrees`); `x-tab.tsx` is its tab. There are no barrel files: a file imports what it uses from the file
  that defines it. `core/` imports nothing outside itself, and no file imports in a cycle.
  [tabs.ts](../cockpit/hooks/pane/tabs.ts) is the one table of tabs: every way of opening a tab (its button,
  `/cockpit tab`, a link from another tab or from the chat) goes through `openTab()`, which reads again what the tab
  shows (`showTab()` from the chat or a command, which opens the pane first).
- **Memory a model names once, then keeps up by itself.** At session start `buildMemory()` reads every source file's
  imports; a model names the features only the first time, on Map again, or when over a quarter of the files are new
  to them. Otherwise `adoptFiles()` puts a new file in the feature most of its folder (else its imports) is in, and a
  gone file leaves its feature. The memory is written as an index plus a page per feature so Claude opens one small
  page to find a file; only pages whose text changed are written, and a page whose feature is gone is left saying so,
  because the engine cannot delete a file. Limits are marked: 1500 files, 300 KB a file.
- **Draw for every surface.** The pane runs in a terminal and in the desktop app. Views use the surface's elements
  (`v.ui`), the theme's tokens and `sp(v, n)`; SVG is desktop-only and gets a text fallback. Tests render every tab
  at widths from 28 to 160 columns on both surfaces.
- **Safe by default.** Model calls, push, pull requests and Verify-after-turn are off or behind the judges' rules
  until turned on; `RISKY`, `PERSONAL` and `OPEN` decide what always comes to you. Anything written outside
  `.cockpit/` is re-read first and keeps what it does not change. Every `$.model` call carries a
  `// privacy: <id>` comment matched by a row in [privacy.md](privacy.md), enforced by
  [check_privacy.py](../scripts/check_privacy.py).
- **Simple heuristics over learned ones**, marked as such. `pickRun()` is a small rules table; a flow's kind comes
  from the prompt's words. Deliberate shortcuts are marked in the code with `// ponytail:` comments naming their limit
  (for example, `findRepos()` looks two levels deep for at most 20 repositories).
- **One plugin, extensible.** The add-on split was undone in favour of one plugin; the `cockpit.*` events stay so
  another plugin can read and change the state or call an action by name.

## 5. How to build, test and run it

Needs Claude Code 2.1.275 or later, Node.js for the type-check, Python 3 for the checks. There is no build step: Claude
Code loads the TypeScript directly.

```sh
./dev.sh                                   # Claude Code with Cockpit loaded from this checkout (dev.cmd on Windows)
```

Saving a file under `cockpit/hooks/` reloads the mod when the current turn ends; `/cockpit` opens the pane.

The checks, from the repository root (all must pass; see [CONTRIBUTING.md](../CONTRIBUTING.md)):

```sh
claude plugin test ./cockpit               # the tests in cockpit/tests
npx -p typescript tsc -p cockpit           # type-check; needs ./dev.sh run once (it writes cockpit/.claude-plugin/types/)
claude plugin validate ./cockpit           # what the engine would refuse
python3 scripts/check_links.py             # every relative Markdown link resolves
python3 scripts/check_privacy.py           # every model call is documented in docs/privacy.md
python3 scripts/check_turn_undo.py         # turn snapshot and undo commands on a real temporary repo
python3 scripts/check_worktrees.py         # agent worktree bring-back and remove on a real repo
python3 scripts/check_release.py           # one version in plugin.json and marketplace.json, dated changelog
```

CI ([ci.yml](../.github/workflows/ci.yml)) runs all but the type-check, which needs a loaded session.
`python3 scripts/draw_previews.py` redraws [docs/images/](images) from the pane's own tree (needs Google Chrome).

**Tests.** [features.test.tsx](../cockpit/tests/features.test.tsx) starts with `stand()`, which stands in for the
engine (clock, processes, models, agents, store, toasts) and logs what Cockpit asked for, so a test can drive a feature
end to end (a prompt, tool calls, a press) and check what is drawn or written. The other files cover one area each
(`git.test.tsx`, `turns.test.ts`, `worktrees.test.ts`, `rules.test.tsx`, `spend.test.tsx`, …);
[renders.test.tsx](../cockpit/tests/renders.test.tsx) and [sizes.test.tsx](../cockpit/tests/sizes.test.tsx) draw
every tab at every width. [logic.test.ts](../cockpit/tests/logic.test.ts) checks the pure helpers against a table of
inputs and what each must give.

**Releasing.** Bump the version in [plugin.json](../cockpit/.claude-plugin/plugin.json) and
[marketplace.json](../.claude-plugin/marketplace.json) together, date the section in the changelog, then run
`python3 scripts/check_release.py --releasing`. Claude Code only sends an update when the version changes.

## 6. Where to start for common changes

| You want to… | Start here |
|---|---|
| Change what a tab shows | its file ([overview-tab.tsx](../cockpit/hooks/pane/overview-tab.tsx), [activity-tab.tsx](../cockpit/hooks/memory/activity-tab.tsx), [agents-tab.tsx](../cockpit/hooks/agents/agents-tab.tsx), [git-tab.tsx](../cockpit/hooks/git/git-tab.tsx), [rules-tab.tsx](../cockpit/hooks/rules/rules-tab.tsx)); shared pieces in [shared.tsx](../cockpit/hooks/ui/shared.tsx). Then run the render and size tests, and `draw_previews.py` for Overview, Agents or Rules |
| Change the band, spinner or chat cards | [drawings.tsx](../cockpit/hooks/chat/drawings.tsx) |
| Add a `/cockpit` sub-command | `runCockpitCommand()` in [commands.ts](../cockpit/hooks/commands.ts); update the command's `description`/`argumentHint` in [register.tsx](../cockpit/hooks/register.tsx) and the README's command table |
| React to a new event or tool | add an `on(...)` in [register.tsx](../cockpit/hooks/register.tsx), keep calling `next(e)`, put the work in its feature's folder |
| Add an action a button runs | its feature's folder (the `-io.ts` file where there is one); add it to `ACTS` and the switch in [acts.ts](../cockpit/hooks/acts.ts) if other plugins should call it by name; wrap slow work in `inBackground()` |
| Add a value to the state | declare it (optional) in [types/index.d.ts](../cockpit/types/index.d.ts), give a default in [state.ts](../cockpit/hooks/core/state.ts) if needed; add it to `PREFS` in [core.ts](../cockpit/hooks/core/core.ts) if it should outlast a session |
| Change commits, push, the PR or accounts | [git/git.ts](../cockpit/hooks/git/git.ts), [pr.ts](../cockpit/hooks/git/pr.ts), [accounts.ts](../cockpit/hooks/git/accounts.ts) and [git-tab.tsx](../cockpit/hooks/git/git-tab.tsx); see [git.md](git.md) |
| Change turn undo or agent worktrees | the JSON in [turns.ts](../cockpit/hooks/git/turns.ts) or [worktrees.ts](../cockpit/hooks/agents/worktrees.ts), then run its `check_*.py` |
| Change how the judges or the autopilot decide | [judges/decisions.ts](../cockpit/hooks/judges/decisions.ts) and [autopilot.ts](../cockpit/hooks/judges/autopilot.ts); see [judges.md](judges.md) and [autopilot.md](autopilot.md) |
| Change an expert's behaviour or model | its file in [cockpit/agents/](../cockpit/agents); the model choice per task is [pick.ts](../cockpit/hooks/agents/pick.ts), from each expert's start in [experts.ts](../cockpit/hooks/core/experts.ts) |
| Change pipelines, testers or hand-offs | [agents/agents.ts](../cockpit/hooks/agents/agents.ts), with `PIPELINES` and `TESTERS` in [experts.ts](../cockpit/hooks/core/experts.ts); see [agents.md](agents.md) |
| Change flows and progress | `FLOWS`, `STEPS` and `progress()` in [flows.ts](../cockpit/hooks/flows/flows.ts); see [flows.md](flows.md) |
| Change the codebase memory | [memory.ts](../cockpit/hooks/memory/memory.ts) (pure: features, `adoptFiles()`, the pages from `memoryMarkdown()`) and [memory-io.ts](../cockpit/hooks/memory/memory-io.ts) (I/O: build, update, `syncMemory()`, saving); tests in [memory.test.tsx](../cockpit/tests/memory.test.tsx) |
| Change the Rules tab | [rules.ts](../cockpit/hooks/rules/rules.ts), [rules-io.ts](../cockpit/hooks/rules/rules-io.ts), [rules-tab.tsx](../cockpit/hooks/rules/rules-tab.tsx) |
| Add or change a theme | [theme.ts](../cockpit/hooks/core/theme.ts) and the `Palette` type; `contrast.test.ts` checks legibility |
| Add a model call | add a `// privacy: <id>` comment above it and a row in [privacy.md](privacy.md); keep it off by default |

Every change gets a test (a fix's test fails without the fix) and a line under `[Unreleased]` in
[CHANGELOG.md](../CHANGELOG.md); update [cockpit/README.md](../cockpit/README.md) and the matching doc page when what a
person sees changes.

[All docs](README.md) · [Architecture](architecture.md) · [Contributing](../CONTRIBUTING.md)
