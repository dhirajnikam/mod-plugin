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
- [**Autopilot**](../docs/autopilot.md): work on a goal until the judges agree it is done, or lead the product goal after goal
- [**Judges**](../docs/judges.md) and [**flows**](../docs/flows.md): who answers Claude's questions, and how progress is counted

Before you turn it on, read [Privacy and cost](../docs/privacy.md): what Cockpit keeps, spends and turns on by default.

## Code

| File | Holds |
|---|---|
| `hooks/register.tsx` | event hooks, in order: prompts, tool calls, judges, turn ends, agents |
| `hooks/commands.ts`, `acts.ts`, `turn-io.ts` | the `/cockpit` command; the actions another plugin can call by name; a turn's start and end |
| `hooks/core/` | the state (declared in `core.ts`, first value in `state.ts`), repos, history, spend, notices, the themes, the experts table |
| `hooks/flows/` | flows, their steps and progress |
| `hooks/git/` | git, gh accounts, commits, the pull request, the commit graph, turn snapshots and undo, the Git tab |
| `hooks/agents/` | the experts, pipelines, hand-offs, testers, worktrees, the model choice, the Agents tab |
| `hooks/judges/` | the judges and the autopilot |
| `hooks/memory/` | the codebase memory, the feature map, the codebase guide, the Activity tab |
| `hooks/rules/` | the Rules tab and its reading and changing of settings and `CLAUDE.md` |
| `hooks/pane/` | the side pane: its header and tabs, the whole pane with the open tab, the Overview tab |
| `hooks/ui/` | the pieces the tabs share; the ring and other SVG drawings |
| `hooks/chat/drawings.tsx` | every drawing around the chat: the band, the spinner, the chat's cards |
| `types/index.d.ts` | the state contract |
| `agents/*.md` | the six experts |

The code is laid out by feature; where a feature has the pair, `x.ts` is its pure logic and `x-io.ts` its engine
I/O; `x-tab.tsx` is its tab. To work on it, see [CONTRIBUTING.md](../CONTRIBUTING.md).
