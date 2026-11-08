# Architecture

How Cockpit is put together, for someone about to change it. Read [CONTRIBUTING.md](../CONTRIBUTING.md) first for
the dev loop and the checks.

## The shape of it

Cockpit is a Claude Code **mod**: one hooks module, `cockpit/hooks/register.tsx`, that Claude Code loads and calls on
its events. Every hook has the form `($, e, next)`: `$` is the engine's interface (files, processes, models, agents,
drawing), `e` the event, and `next(e)` runs whatever comes after Cockpit (other plugins, then Claude Code itself).
Cockpit almost always calls `next(e)` and records what happened; it seldom changes an event.

```
Claude Code events ──▶ register.tsx (hooks) ──▶ ops/ (what to do) ──▶ set(): the state ──▶ ui.render hooks redraw
                                                    │                        │
                                               git, gh, models,         tabs/ (the pane),
                                               agents, files            drawings.tsx (band, spinner, chat cards)
```

- **What Cockpit does** is in `hooks/ops/`, one file per concern: `core.ts` (the state, `set()`, notes, paths,
  history), `git.ts` (git, gh, commits, accounts), `agents.ts` (experts, pipelines, hand-offs, testers),
  `decisions.ts` (the judges and the autopilot, which call each other), `memory-io.ts` (mapping the codebase, writing
  flow steps) and `rules-io.ts` (the Rules tab's files). Every arrow points at `core.ts`, and `agents.ts` also uses
  `git.ts`: there are no import cycles. `hooks/actions.ts` re-exports them all, so the rest imports from `./actions`.
- **State** is one atom, its type `Ph` in `cockpit/types/index.d.ts`, its first value in `hooks/state.ts`. Claude
  Code reads an atom from its literal plugin and key in the module that names it, so every module that reads the state
  declares the same atom (`atom({ plugin: 'cockpit', key: 's' }, …)`) rather than importing it. Every change goes
  through `set()` in `ops/core.ts`, which also saves the preferences that outlast a session. A drawing reads the
  state; a change to it redraws the readers.
- **Pure helpers** live apart so they can be tested without the engine: `logic.ts` (flows, progress, diffs, the file
  tree, the judges' tally, the SVG drawings), `memory.ts` (imports, features, impact, the feature map), `rules.ts`
  (reading and changing settings and `CLAUDE.md`), `theme.ts` (the themes).

## Events and where they are handled

All hooks are registered from `register.tsx`; the `ui.render` hooks are in `drawings.tsx` and `full-pane.tsx`, which it calls.

| Event | What Cockpit does |
|---|---|
| `session.start` | loads preferences and history, maps the codebase, registers the experts and commands, starts the live-figure timers |
| `command.run` (`cockpit`) | the `/cockpit` command: tabs, focus, theme, mode, flow, run, test, autopilot |
| `command.run` (`goal`) | notes the goal you set with `/goal` |
| `prompt.submit` | opens a flow for your prompt and asks a model for its steps |
| `turn.start` | opens or carries on a flow for a turn that came without a prompt of yours (`/goal`, a continuation, a prompt another plugin kept) |
| `prompt.compose` | adds the codebase memory to Claude's system prompt |
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

Each tab is a file in `hooks/tabs/`, its function called from the `Pane` hook in `hooks/full-pane.tsx` (`hooks/views.tsx` re-exports them):

| Tab | Function | Uses |
|---|---|---|
| Overview (`tabs/overview.tsx`) | `Overview` | `progress()` and `ringSvg()` from `logic.ts`; `neuralSvg()` and `similarRuns()` for the agents |
| Activity (`tabs/activity.tsx`) | `Files` | `FeatureMap`, `Memory` (impact and features), `tree()` from `logic.ts`, `featureMapSvg()` from `memory.ts` |
| Agents (`tabs/agents.tsx`) | `Agents` | `Tracker`, `AgentMap` and `agentGraph()`, `agentIconSvg()` from `logic.ts`; starts go through `runExpert`, `startPipeline`, `spawnAgent` in `ops/agents.ts` |
| Git (`tabs/git.tsx`) | `Git` | `History` (the graph), `AccountBox`, `Setup`, `Options`; git and gh calls in `ops/git.ts` |
| Rules (`tabs/rules.tsx`) | `Rules` | `rules.ts` for the changes; `loadRules`, `writeSettings`, `writeInstructions` in `ops/rules-io.ts` |

Shared drawing pieces in `tabs/shared.tsx`: `Bar`, `Segs`, `Seg` (a segmented choice), `Check`, `Head` (a section heading),
`MapText` (a map drawn as text where there is no SVG), `Card` (a chat card).

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
  judges and tallies their votes → in Auto mode a clear winner answers; `RISKY`, `PERSONAL` and `OPEN` in `ops/decisions.ts`
  decide what always comes to you.
- **The autopilot**: `startAutopilot()` sends cycle 1 → each main `turn.complete` calls `autopilotTurnEnd()`, which
  reads the `AUTOPILOT:` line, checks the limits and the stall count, puts a claim of done to the judges, and sends the
  next cycle (`sendCycle()`).

## What is kept where

- **The session's state**: the atom, for the life of the session (it outlasts a reload of the mod).
- **Across sessions** (Claude Code's plugin store, `$.store`): preferences, Git settings and accounts per repository,
  the agents you made.
- **In the repository** (`.cockpit/`, git-ignored): `history.json`, `memory.json` and `MEMORY.md`, hand-off briefs,
  and the autopilot's `roadmap.md`. See [Privacy and cost](privacy.md).

## Tests

`cockpit/tests/` uses Claude Code's test kit, `claude-code/testing`, with the engine stood in: `stand()` at the top of
`features.test.tsx` answers the engine's operations (git, models, agents, files) so a test can drive Cockpit end to
end and read what it draws. `renders.test.tsx` and `sizes.test.tsx` draw every tab on the terminal and the desktop at
every width; `logic.ts` has a `selfCheck()` that runs at session start.

[All docs](README.md) · [Project README](../README.md)
