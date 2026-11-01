# Cockpit

A Claude Code mod that shows what a session is doing and gives you its controls, around the prompt and in a side pane.
Built from the "Powerhouse Mod v2" design.

## Install

Requires Claude Code 2.1.275 or later. At the prompt of a Claude Code session:

```
/plugin install cockpit --marketplace dhirajnikam/mod-plugin
```

`/cockpit` opens the pane. Later versions arrive with `claude plugin update cockpit`.

## What it adds

- [**Overview**](../docs/overview.md): progress by flow, checks, the agents at work as a neural view, context, decisions
- [**Activity**](../docs/activity.md): a live feed, your codebase's features as a map, the impact of a change
- [**Agents**](../docs/agents.md): pipelines, six experts, agents made from a description, trackers, connections, memory
- [**Git**](../docs/git.md): commits written from the diff, commit modes, a git graph, accounts
- [**Rules**](../docs/rules.md): hooks, permission rules and instructions, for the repository or for you
- [**Autopilot**](../docs/autopilot.md): work on a goal until the judges agree it is done
- [**Judges**](../docs/judges.md) and [**flows**](../docs/flows.md): who answers Claude's questions, and how progress is counted

Before you turn it on, read [Privacy and cost](../docs/privacy.md): what Cockpit keeps, spends and turns on by default.

## Code

| File | Holds |
|---|---|
| `hooks/register.tsx` | event hooks: prompts, tool calls, judges, turn ends, agents, and every drawing outside the pane |
| `hooks/views.tsx` | the pane's header, tabs and tab views |
| `hooks/actions.ts` | git, judges, experts and pipelines, agents, the autopilot, history |
| `hooks/logic.ts` | pure helpers: flows and progress, diffs, the tree, the ring and other SVG drawings |
| `hooks/memory.ts` | the codebase memory and the feature map |
| `hooks/rules.ts` | the Rules tab's reading and changing of settings and `CLAUDE.md` |
| `hooks/theme.ts` | the themes |
| `hooks/state.ts` | the initial state |
| `types/index.d.ts` | the state contract |
| `agents/*.md` | the six experts |

`hooks/logic.ts` has a `selfCheck()` that runs at session start and logs any failure. To work on it, see
[CONTRIBUTING.md](../CONTRIBUTING.md).
