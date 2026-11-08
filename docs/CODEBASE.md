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
`cockpit.act` and `cockpit.tab` events in `register.tsx`, `tabsAvailable` in the state, and `paneFrame()` in
`pane.tsx` (now called by nothing) exist so another plugin can extend Cockpit.

Not tracked: `.cockpit/` (Cockpit's own per-repository data, which writes its own `.gitignore`), `node_modules/`, and
`cockpit/.claude-plugin/types/` (types Claude Code writes when it loads the mod).

### The modules in cockpit/hooks/

**Entry and wiring**

- [register.tsx](../cockpit/hooks/register.tsx): the hooks module. Registers every event hook (`session.start`,
  `prompt.submit`, `turn.start`, `tool.call`, `turn.complete`, `agent.spawn`, …), the `/cockpit` command and its
  sub-commands, the live-figure timers, and the extension events. It holds the per-turn bookkeeping (what changed
  since the prompt, the running flow) in closure variables.
- [acts.ts](../cockpit/hooks/acts.ts): actions callable by name (`ACTS` and `act()`), for `cockpit.act`.

**What Cockpit does: [ops/](../cockpit/hooks/ops), re-exported by [actions.ts](../cockpit/hooks/actions.ts)**

| File | Concern |
|---|---|
| [core.ts](../cockpit/hooks/ops/core.ts) | The state atom and `set()`, preferences, history, toasts and notes, `repoRoot()` (including picking a repo when the session folder holds several), `git()`, and `claim`/`release`/`inBackground` for slow work |
| [git.ts](../cockpit/hooks/ops/git.ts) | Refreshing the repo, commit messages and commit modes, push, gh accounts, the pull request and its checks, turn snapshots and undo, agent worktrees |
| [agents.ts](../cockpit/hooks/ops/agents.ts) | Registering the experts, starting agents and pipelines, hand-offs to Claude, tracking and finishing agents, the testers, measuring context |
| [decisions.ts](../cockpit/hooks/ops/decisions.ts) | The judges (`judge()`, `judgeNext()`, the `RISKY`/`PERSONAL`/`OPEN` rules) and the autopilot (start, stop, resume, `autopilotTurnEnd()`) |
| [memory-io.ts](../cockpit/hooks/ops/memory-io.ts) | Building and updating the codebase memory; asking a model for a flow's steps |
| [rules-io.ts](../cockpit/hooks/ops/rules-io.ts) | Reading and writing settings, `CLAUDE.md`, skills and MCP servers for the Rules tab |
| [notify.ts](../cockpit/hooks/ops/notify.ts) | One notice when a turn, agent or autopilot cycle finishes while you are not watching; the daily budget warning |
| [explain.ts](../cockpit/hooks/ops/explain.ts) | `/cockpit explain`: the prompt that asks Claude to write this guide, and the guide's row state |

**Pure logic, testable without the engine**

| File | What it computes |
|---|---|
| [logic.ts](../cockpit/hooks/logic.ts) | Flows and their steps, progress, diffs, the file tree, the judges' tally, SVG drawings, `selfCheck()` |
| [memory.ts](../cockpit/hooks/memory.ts) | Imports, features (folders), impact of a change, the feature map, `memoryText()` for the prompt |
| [rules.ts](../cockpit/hooks/rules.ts) | Reading and changing settings and `CLAUDE.md` text while keeping the rest of the file |
| [spend.ts](../cockpit/hooks/spend.ts) | Spend per session and per day, budget levels |
| [turns.ts](../cockpit/hooks/turns.ts) | The git commands for turn snapshots and undo, as JSON data |
| [worktrees.ts](../cockpit/hooks/worktrees.ts) | The git commands for agent worktrees, as JSON data, and `fillArgs()` |
| [pick.ts](../cockpit/hooks/pick.ts) | `pickRun()`: an agent's model, effort and helper count from its kind and task words |
| [theme.ts](../cockpit/hooks/theme.ts) | The five palettes, reduced to the tokens a terminal draws with |

**Drawing**

- [state.ts](../cockpit/hooks/state.ts): `INITIAL`, the state's first value, and `PANE`, the pane's id.
- [drawings.tsx](../cockpit/hooks/drawings.tsx): everything around the chat: the band above the prompt, the
  spinner's words, the line under the prompt, tool-use cards, and what Focus hides.
- [full-pane.tsx](../cockpit/hooks/full-pane.tsx): the side pane (header, tabs, open tab); [pane.tsx](../cockpit/hooks/pane.tsx)
  builds what the pane draws with (`paneV()`: elements, state, theme, width).
- [tabs/](../cockpit/hooks/tabs), re-exported by [views.tsx](../cockpit/hooks/views.tsx): one file per tab
  ([overview.tsx](../cockpit/hooks/tabs/overview.tsx), [activity.tsx](../cockpit/hooks/tabs/activity.tsx),
  [agents.tsx](../cockpit/hooks/tabs/agents.tsx), [git.tsx](../cockpit/hooks/tabs/git.tsx),
  [rules.tsx](../cockpit/hooks/tabs/rules.tsx)), plus [header.tsx](../cockpit/hooks/tabs/header.tsx),
  [shared.tsx](../cockpit/hooks/tabs/shared.tsx) (shared pieces and `sp()` spacing) and
  [guide.tsx](../cockpit/hooks/tabs/guide.tsx) (the Overview's codebase-guide row).

## 3. How a request and the data flow through it

```
Claude Code event ──▶ register.tsx hook ──▶ next(e) (Claude Code carries on)
                             │
                             └──▶ ops/* action ──▶ git, gh, $.model, agents, files
                                        │
                                        ▼
                                   set(): the state atom ──▶ ui.render hooks redraw (tabs/, drawings.tsx)
                                        ▲
         press in the pane ─────────────┘   (Button onPress calls an action from ./actions)
```

Every hook has the shape `($, e, next)`: `$` is the engine interface (files, processes, models, agents, clock,
store, UI), `e` the event, and `next(e)` runs what comes after Cockpit. Cockpit almost always calls `next(e)` and
records what happened; it rarely changes an event. Most hooks end in `.catch(($, e, next) => next(e))`, so a failure
in Cockpit never blocks the session.

**A prompt, end to end** (all in [register.tsx](../cockpit/hooks/register.tsx) unless named):

1. `prompt.submit`: skips Cockpit's own hand-offs and commands; otherwise `openFlow()` records a new flow and the
   repository's changes at that moment, then `writeSteps()` ([memory-io.ts](../cockpit/hooks/ops/memory-io.ts)) asks
   a model for the flow's steps in the background so the prompt is not held. A prompt refused further down removes
   its flow again.
2. `turn.start`: a turn with no prompt of yours (a `/goal` continuation, a queued prompt) carries on the last flow
   or opens one. A snapshot of the working tree is taken before the turn (`snapTurn()` in
   [git.ts](../cockpit/hooks/ops/git.ts)).
3. `prompt.compose`: adds the codebase memory (`memoryText()`) to Claude's system prompt.
4. `tool.call`: each call is recorded as a file operation and moves the flow's steps; `TodoWrite`, `TaskCreate`
   and `TaskUpdate` make Claude's task list the flow's steps; `AskUserQuestion` goes to `judge()`
   ([decisions.ts](../cockpit/hooks/ops/decisions.ts)).
5. `turn.complete`: closes the flow, refreshes the repo, takes the after-snapshot, measures context, syncs agents,
   lets the autopilot decide its next cycle, updates the memory for changed files, sends a notice, starts Verify
   and/or `decideCommit()` depending on the Git settings, saves history and checks the daily budget.

**An agent** follows the same events with `e.agentId` set: started from the Agents tab (`runExpert`,
`startPipeline`, `spawnAgent` in [agents.ts](../cockpit/hooks/ops/agents.ts)) or by Claude's `Agent` tool;
`agent.spawn` records it; its `turn.complete` runs `finishAgent()` (reads its `CASE`, `REPORT` and `HANDOFF`
lines), `advancePipeline()` and `testAgent()`. A timer calls `syncAgents()` to catch agents Cockpit's hooks missed.

**Timers** set in `session.start`: a redraw every 400 ms while anything runs, `syncAgents()` every 2 s, and the repo,
PR, context and guide re-read every 15 s while the pane is shown.

**Where data lives**: the session's state in the atom; preferences, Git settings and accounts in Claude Code's plugin
store (`$.store`); history, memory, hand-offs and roadmaps in the repository's `.cockpit/`; turn snapshots under
`refs/cockpit/turns/`. See [architecture.md](architecture.md#what-is-kept-where) and [privacy.md](privacy.md).

## 4. Design decisions and the approach

- **Observe, don't intercept.** Hooks call `next(e)` and record; Cockpit changes an event only where it must (adding
  the memory section, a `tool.check` on `Agent`). Failures fall through to `next(e)`. Trade-off: it sees what the
  engine reports and no more, so some things are reconstructed (agents from the engine's list, a turn's changes from
  `git status` before and after).
- **One state atom, one writer.** All state is one value of type `Ph`; every change goes through `set()` in
  [core.ts](../cockpit/hooks/ops/core.ts), which also saves the preferences (`PREFS`) that outlast a session. Drawings
  only read it. The engine finds an atom by its literal plugin and key in the module that declares it, so each
  module that reads state declares the same `atom({ plugin: 'cockpit', key: 's' }, INITIAL, { shape: 'ph-25' })`
  instead of importing it. When `Ph` changes shape, bump `ph-25` everywhere it appears so an older stored value
  reads as `INITIAL`; new fields are optional so an older saved session still loads.
- **Shared locks live in the state, not in module variables.** `claim()`/`release()` keep a `busy` map in the atom,
  because a module-level variable may be a separate copy per importing module. Slow work from a press runs through
  `inBackground()` since Claude Code drops a press that waits past 10 s.
- **Pure logic apart from engine I/O.** `logic.ts`, `memory.ts`, `rules.ts`, `spend.ts`, `pick.ts` and the command
  data in `turns.ts`/`worktrees.ts` take values and return values, so tests exercise them directly.
- **Git commands as data, proven on real git.** The test kit cannot run processes, so the snapshot, undo and worktree
  commands are JSON between markers in [turns.ts](../cockpit/hooks/turns.ts) and
  [worktrees.ts](../cockpit/hooks/worktrees.ts); [check_turn_undo.py](../scripts/check_turn_undo.py) and
  [check_worktrees.py](../scripts/check_worktrees.py) read those same lists and run them on a temporary repository,
  so the two cannot drift. Snapshots use a temporary index, so your index and branches are never touched.
- **Barrel files keep imports stable.** The code was split by concern into `ops/` and `tabs/`; `actions.ts` and
  `views.tsx` re-export them so everything else still imports from `./actions` and `./views`. Every `ops/` file
  depends on `core.ts` (and `agents.ts` also on `git.ts`), with no import cycles.
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
every tab at every width. `selfCheck()` in `logic.ts` also runs at session start.

**Releasing.** Bump the version in [plugin.json](../cockpit/.claude-plugin/plugin.json) and
[marketplace.json](../.claude-plugin/marketplace.json) together, date the section in the changelog, then run
`python3 scripts/check_release.py --releasing`. Claude Code only sends an update when the version changes.

## 6. Where to start for common changes

| You want to… | Start here |
|---|---|
| Change what a tab shows | its file in [tabs/](../cockpit/hooks/tabs); shared pieces in [shared.tsx](../cockpit/hooks/tabs/shared.tsx). Then run the render and size tests, and `draw_previews.py` for Overview, Agents or Rules |
| Change the band, spinner or chat cards | [drawings.tsx](../cockpit/hooks/drawings.tsx) |
| Add a `/cockpit` sub-command | the `command.run` hook for `cockpit` in [register.tsx](../cockpit/hooks/register.tsx); update its `description`/`argumentHint` and the README's command table |
| React to a new event or tool | add an `on(...)` in [register.tsx](../cockpit/hooks/register.tsx), keep calling `next(e)`, put the work in an `ops/` file |
| Add an action a button runs | the right file in [ops/](../cockpit/hooks/ops) (it is re-exported by `actions.ts`); add it to [acts.ts](../cockpit/hooks/acts.ts) if other plugins should call it by name; wrap slow work in `inBackground()` |
| Add a value to the state | declare it (optional) in [types/index.d.ts](../cockpit/types/index.d.ts), give a default in [state.ts](../cockpit/hooks/state.ts) if needed; add it to `PREFS` in [core.ts](../cockpit/hooks/ops/core.ts) if it should outlast a session |
| Change commits, push, the PR or accounts | [ops/git.ts](../cockpit/hooks/ops/git.ts) and [tabs/git.tsx](../cockpit/hooks/tabs/git.tsx); see [git.md](git.md) |
| Change turn undo or agent worktrees | the JSON in [turns.ts](../cockpit/hooks/turns.ts) or [worktrees.ts](../cockpit/hooks/worktrees.ts), then run its `check_*.py` |
| Change how the judges or the autopilot decide | [ops/decisions.ts](../cockpit/hooks/ops/decisions.ts); see [judges.md](judges.md) and [autopilot.md](autopilot.md) |
| Change an expert's behaviour or model | its file in [cockpit/agents/](../cockpit/agents); the model choice per task is [pick.ts](../cockpit/hooks/pick.ts) |
| Change pipelines, testers or hand-offs | [ops/agents.ts](../cockpit/hooks/ops/agents.ts); see [agents.md](agents.md) |
| Change flows and progress | `FLOWS`, `STEPS` and `progress()` in [logic.ts](../cockpit/hooks/logic.ts); see [flows.md](flows.md) |
| Change the codebase memory | [memory.ts](../cockpit/hooks/memory.ts) (pure) and [ops/memory-io.ts](../cockpit/hooks/ops/memory-io.ts) (I/O) |
| Change the Rules tab | [rules.ts](../cockpit/hooks/rules.ts), [ops/rules-io.ts](../cockpit/hooks/ops/rules-io.ts), [tabs/rules.tsx](../cockpit/hooks/tabs/rules.tsx) |
| Add or change a theme | [theme.ts](../cockpit/hooks/theme.ts) and the `Palette` type; `contrast.test.ts` checks legibility |
| Add a model call | add a `// privacy: <id>` comment above it and a row in [privacy.md](privacy.md); keep it off by default |

Every change gets a test (a fix's test fails without the fix) and a line under `[Unreleased]` in
[CHANGELOG.md](../CHANGELOG.md); update [cockpit/README.md](../cockpit/README.md) and the matching doc page when what a
person sees changes.

[All docs](README.md) · [Architecture](architecture.md) · [Contributing](../CONTRIBUTING.md)
