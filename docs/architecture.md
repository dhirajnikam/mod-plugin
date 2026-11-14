# Architecture

How Cockpit is put together, for someone about to change it. Read [CONTRIBUTING.md](../CONTRIBUTING.md) first for
the dev loop and the checks.

## The shape of it

Cockpit is a Claude Code **mod**: one hooks module, `cockpit/hooks/register.tsx`, that Claude Code loads and calls on
its events. Every hook has the form `($, e, next)`: `$` is the engine's interface (files, processes, models, agents,
drawing), `e` the event, and `next(e)` runs whatever comes after Cockpit (other plugins, then Claude Code itself).
Cockpit almost always calls `next(e)` and records what happened; it seldom changes an event.

```
Claude Code events ──▶ register.tsx (hooks) ──▶ a feature's folder (what to do) ──▶ set(): the state ──▶ ui.render hooks redraw
                                                    │                                      │
                                               git, gh, models,                       the tabs (the pane),
                                               agents, files                          chat/drawings.tsx (band, spinner, chat cards)
```

- **What Cockpit does** is in `cockpit/hooks/`, one folder per feature: `core/` (the state, `look()` and `set()`,
  notes, paths, history, spend, finish notices and the daily budget, the themes), `flows/` (flows, their steps, a
  turn's start and end), `git/` (git, gh, commits, accounts, the pull request, turn snapshots), `agents/` (experts,
  pipelines, hand-offs, testers, worktrees), `judges/` (the judges and the autopilot), `memory/` (mapping the
  codebase, the feature map, the codebase guide), `rules/` (the Rules tab's files), `pane/` (the side pane, its header
  and the table of tabs), `ui/` (the pieces the tabs share) and `chat/` (the drawings around the chat). Beside
  `register.tsx` sit `commands.ts` (the `/cockpit` command) and `acts.ts` (the actions callable by name). Where a
  feature has the pair, `x.ts` is its pure logic and `x-io.ts` its engine I/O; `x-tab.tsx` is its tab. `core/` imports
  nothing outside itself, and there are no import cycles.
- **State** is one atom, its type `Ph` in `cockpit/types/index.d.ts`, its first value in `hooks/core/state.ts`. Claude
  Code lets an atom be used only in the file that declares it, so it is declared once, in `hooks/core/core.ts`;
  everything else reads the state with `look($)` and changes it with `set($, patch)` or `setUi($, uiPatch)`. `set()`
  also saves the preferences that outlast a session. A drawing reads the state; a change to it redraws the readers.
- **Pure helpers** live apart so they can be tested without the engine: `flows/flows.ts` and `flows/tools.ts` (flows,
  progress, steps), `git/git-form.ts` and `git/graph.ts` (branch and commit patterns, the commit graph),
  `agents/experts.ts` and `agents/pick.ts` (the experts, an agent's model and effort), `judges/judges.ts` (the judges'
  tally), `memory/memory.ts`, `memory/memory-map.ts` and `memory/tree.ts` (imports, features, impact, the feature map,
  the file tree), `rules/rules.ts` (reading and changing settings and `CLAUDE.md`), `ui/svg.ts` (the SVG drawings),
  `core/theme.ts` (the themes).

## Events and where they are handled

All hooks are registered from `register.tsx`; the `ui.render` hooks are in `chat/drawings.tsx` and `pane/full-pane.tsx`,
which it calls, and the `/cockpit` command's work is in `commands.ts`.

| Event | What Cockpit does |
|---|---|
| `session.start` | loads preferences and history, maps the codebase, registers the experts and commands, starts the live-figure timers |
| `command.run` (`cockpit`) | the `/cockpit` command: tabs, focus, theme, mode, flow, run, test, autopilot |
| `command.run` (`goal`) | notes the goal you set with `/goal` |
| `prompt.submit` | opens a flow for your prompt and asks a model for its steps; attaches the features the prompt's words name (`recall()`) and syncs the memory with git's file list in the background |
| `turn.start` | opens or carries on a flow for a turn that came without a prompt of yours (`/goal`, a continuation, a prompt another plugin kept) |
| `prompt.compose` | adds the codebase memory to Claude's system prompt: every feature on one line with its page; when a hook above sends the event past this one, `prompt.submit` carries the same text beside the next prompt, once |
| `tool.call` (any tool) | records file operations, moves the flow's steps, logs a subagent's calls, counts its edits |
| `tool.call` (`TodoWrite`, `TaskCreate`, `TaskUpdate`, the app's `update_plan`) | Claude's or a subagent's task list becomes the flow's steps or the agent's tracker |
| `tool.call` (`wrap_up`) | ticks the task list off; the next-step question goes to the judges |
| `tool.call` (`AskUserQuestion`) | the judges answer, advise, or leave the question to you |
| `tool.call` (`ProposeGoal`) | notes the goal Claude proposed |
| `tool.check` (`Agent`) | asks you to approve a start auto mode would refuse |
| `agent.spawn` | records a subagent: who started it, its type, which plugin provides it |
| `turn.complete` | closes the flow; for a subagent, its result, its pipeline's next step and its testers; then commits, Verify, history, and the autopilot's next cycle |
| `session.measure` | the context window's figures |
| `ui.render` (`Pane`) | the side pane: `Header`, `Tabs`, then the tab's view |
| `ui.render` (`AbovePrompt`, `Spinner`, `PromptHint`) | the band above the prompt, the spinner's words, the line under the prompt |
| `ui.render` (`ToolUse`, `ToolGroup`, `TurnDuration`, `UserMessage`, `AssistantMessage`) | the chat's cards and rows, and what Focus hides |

## Where each tab lives

Each tab is a `-tab.tsx` file in its feature's folder, its function called from the `Pane` hook in
`hooks/pane/full-pane.tsx`. `hooks/pane/tabs.ts` is the one table of tabs: every way of opening a tab (its button,
`/cockpit tab`, a link from another tab or the chat) goes through its `openTab()`, which reads again what the tab shows (`showTab()` from the chat or a command: it opens the pane first).

| Tab | Function | Uses |
|---|---|---|
| Overview (`pane/overview-tab.tsx`) | `Overview` | `progress()` from `flows/flows.ts`, `ringSvg()` and `neuralSvg()` from `ui/svg.ts`; `similarRuns()` from `agents/experts.ts` for the agents |
| Activity (`memory/activity-tab.tsx`) | `Files` | `FeatureMap`, `Memory` (impact and features), `tree()` from `memory/tree.ts`, `featureMapSvg()` from `memory/memory-map.ts` |
| Agents (`agents/agents-tab.tsx`) | `Agents` | `Tracker` (an agent's task list), `AgentMap`, `agentGraph()` and `agentIconSvg()` from `agents/agents-view.ts`; starts go through `runExpert`, `startPipeline`, `spawnAgent` in `agents/agents.ts` |
| Git (`git/git-tab.tsx`) | `Git` | `History` (the graph), `AccountBox`, `Setup`, `Options`; git and gh calls in `git/git.ts`, `git/accounts.ts` and `git/pr.ts` |
| Rules (`rules/rules-tab.tsx`) | `Rules` | `rules/rules.ts` for the changes; `loadRules`, `writeSettings`, `writeInstructions` in `rules/rules-io.ts` |

Shared drawing pieces in `ui/shared.tsx`: `Bar`, `Segs`, `Seg` (a segmented choice), `Check`, `Head` (a section heading),
`Fold` (a heading that folds what is under it), `More` (the fold a tab keeps everything past its first screen under),
`Diff` (lines added and removed). `ui/` knows no feature: a piece that draws one feature's data lives with that feature
(`CommitSkip` in `git/git-tab.tsx`, `Tracker` in `agents/agents-tab.tsx`, `MapText` in `memory/activity-tab.tsx`, `Card`
in `chat/drawings.tsx`).

## The main paths through the code

- **A prompt**: `prompt.submit` → `openFlow()` (a new flow, the repository read) → `writeSteps()` in the background →
  each `tool.call` moves the flow → `turn.complete` closes it, measures the context, and may commit (`decideCommit()`)
  or start Verify.
- **An agent**: started by you (`runExpert`, `startPipeline`), by Claude (the `Agent` tool), or handed to Claude
  (`handOff()`) → `agent.spawn` records it (`trackAgent()`) → its tool calls fill its log and tracker → its
  `turn.complete` reads its CASE, REPORT and HANDOFF lines (`finishAgent()`), moves its pipeline on
  (`advancePipeline()`), and starts its testers (`testAgent()`). Claude Code's own list (`syncAgents()`) catches the
  agents Cockpit did not see start.
- **A decision**: `AskUserQuestion` or a `wrap_up` question → `judge()` scores its complexity, seats 3, 6 or 9
  judges and tallies their votes → in Auto mode a clear winner answers; `RISKY`, `PERSONAL` and `OPEN` in `judges/decisions.ts`
  decide what always comes to you.
- **The autopilot**: `startAutopilot()` sends cycle 1 → each main `turn.complete` calls `autopilotTurnEnd()`, which
  reads the `AUTOPILOT:` line, checks the limits and the stall count, puts a claim of done to the judges, and sends the
  next cycle (`sendCycle()`).

## What is kept where

- **The session's state**: the atom, for the life of the session (it outlasts a reload of the mod).
- **Across sessions** (Claude Code's plugin store, `$.store`): preferences, Git settings and accounts per repository,
  the agents you made.
- **In the repository** (`.cockpit/`, git-ignored): `history.json`, `memory.json`, `MEMORY.md` and the feature pages in `memory/`, hand-off briefs,
  and the autopilot's `roadmap.md`. See [Privacy and cost](privacy.md).

## Tests

`cockpit/tests/` uses Claude Code's test kit, `claude-code/testing`, with the engine stood in: `stand()` at the top of
`features.test.tsx` answers the engine's operations (git, models, agents, files) so a test can drive Cockpit end to
end and read what it draws. `renders.test.tsx` and `sizes.test.tsx` draw every tab on the terminal and the desktop at
every width; `logic.test.ts` checks the pure helpers against a table of inputs and what each must give.

[All docs](README.md) · [Project README](../README.md)
