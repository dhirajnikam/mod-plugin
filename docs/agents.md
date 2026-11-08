# Agents tab, the experts and agent memory

Start, stop and follow subagents, and read what each found. Each run shows in one place.

![The Agents tab: a Verify pipeline running, the running list, connections and the team](images/agents.png)

*A preview drawn from the desktop pane; the app's own spacing differs slightly.*

## The tab, from top to bottom

- **Build, Verify, Review**, **⟳ Autopilot** and **+ New agent** in one row.
- **The running pipeline**, as a card: its experts' icons (the current one turning, a finished one with its result,
  `Prover ✓3/3`), the running step's tracker, the hand-off it carries, and ■ Stop.
- **Running**: every other live run with its tracker (its own task list as a bar, done of all and the task it is on,
  or its current step when it keeps none), its tool calls and time, a red ■ and ✎ (✎ adds your instructions to its brief and runs it again). Its failing test
  cases show under it. Its name opens its cases, report,
  recent steps, who started it, which plugin provides it, and its transcript.
- **Connections**: who started each agent, as a diagram: you, Claude, Cockpit's pipelines, or another agent; a tester
  points at the work it tests; `↗` marks an agent from outside Cockpit (Claude's own types, another plugin's).
- **Team**: the experts and the agents you made, as a launcher: what each is for, ▶ to run it, ✎ to
  run it with your instructions as its task, and a box to tick it for running several at once. A running or finished one points to
  its run (`running ↑`, `done ↓`) instead of repeating it.
- **Finished**: the three newest runs, each with its result (`3/3 passed`, its report), the rest a press away, each with ↻ Restart and ✎; **Clear** empties the list.
  **■ Stop all**, beside Running, stops every live run.
- **Settings**, folded: choose model and effort for me, test each agent's work, and Verify after each turn.

## The experts

Six experts ship with Cockpit: `cockpit:planner`, `builder`, `reviewer`, `prover`, `breaker` and `scribe`. They work
in turn, each handed the task and the REPORT and HANDOFF lines of the experts before it. **Build** runs the planner,
builder, reviewer, Prover, Breaker and scribe; **Verify** runs the Prover (proves the change works) then the Breaker (tries to break it),
whose CASE lines show on their rows and as `tests ✓n/m` in the band; **Review** runs the reviewer.

Every expert, and every agent you make, keeps a short task list (so Cockpit can track it), never commits, pushes or
switches branches (Cockpit handles git) and never writes to `.cockpit/`; the testers keep throwaway scripts in the temp
folder and name any test they leave in the repository.

- **Every agent is tested by two testers**: when an agent's run edits or writes a file (an expert, one you made, or one
  Claude started), the Prover proves it works, then the Breaker tries to break it, both briefed with what that agent
  was asked and reported. Its row shows `+ positive 3/3   − negative 3/4`. A finished run that has not been tested gets
  **± Test**. The testers' own runs say whose work they test ("testing the Builder's work"). A pipeline's steps are
  left to their pipeline, as Build already ends in both testers. **Test each agent's work** in Settings turns this off.
- **+ New agent** makes an agent from a plain description: a model writes its definition (name, when to use it,
  tools, instructions), Cockpit registers it as
  `cockpit:<name>` and keeps it for later sessions. Claude Code dispatches a new type from the next turn on, so if ▶
  right after making one says the type is unknown, send any prompt first. The same form runs a one-off task with any
  agent type: the built-ins, the experts, `.claude/agents/*.md` in the project and in `~/.claude`, each installed
  plugin's agents as `plugin:name`, any type that has started this session, and any other name you type.
- **Several at once**: tick agents and press ▶ Run selected, or type `/cockpit run planner reviewer -- the task`. ▶
  always starts another run; ■ stops every running copy.
- The subagents Claude starts show here as they work, read from Claude Code's own list of agents, so they appear even
  where another plugin's hook keeps Cockpit from seeing them start. A subagent's edits count in the running flow's +/−.

## Model and effort

With **Choose model and effort for me** on (the default), Cockpit picks a model and an effort for each expert and agent
it starts, and the row shows it, for example `haiku · low — light work (typo, docs)`. The rules are a small table in
`hooks/pick.ts`: the kind sets the start (planner and reviewer high on opus, builder and testers on sonnet, scribe on
haiku), light words (rename, typo, docs, readme) step down, hard words (refactor, architecture, security, debug, race)
and a long brief or eight or more changed files step up. The model goes with the spawn; the effort goes on the expert's
definition, which is registered again just before the start, because a spawn has no effort of its own. Pipelines run
one expert at a time, so the helper count the pick returns (two for a big, hard build) is recorded, not used. Off,
agents start with their own defaults. Cockpit cannot change the main session's model or effort: the plugin API reads
the model (`$.session.model()`) and sets none, and `$.config.set` would rewrite the person's saved settings.

## Agent memory

Every finished agent run is kept in `.cockpit/history.json`. When a new task is like an earlier one (by the words that
carry meaning), the runs on it are **remembered**: the Overview draws them under the task, and each expert's brief gets
a REMEMBERED section with what they found, to check rather than trust blindly. A Breaker that once found empty
passwords getting through starts by looking there.

## Agents in auto mode

In auto permission mode Claude Code's classifier judges each subagent by the request to the model that asked for it.
A press in the pane is no such request, so a start from the pane (▶, Start, Restart, a pipeline, `/cockpit test`, the
testers after an agent's edit) can be refused with "no verdict". Where it can, Cockpit puts the start to you in the
permission dialog. Where that is refused too (a managed plugin that runs before Cockpit can stop the dialog), Cockpit
**hands the start to Claude**: a short request in the conversation ("start the cockpit:prover agent with this brief"),
so Claude starts the agent in that turn and auto mode judges it like any agent Claude starts. A waiting pipeline step
takes it, and the hand-off opens no flow of its own. A start your settings or permission mode already allow runs
straight from the pane.

[All docs](README.md) · [Project README](../README.md)
