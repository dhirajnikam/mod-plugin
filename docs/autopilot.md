# Autopilot

The autopilot works on its own, turn after turn, in one of two roles. Start either with **⟳ Autopilot** in the Agents
tab (pick **⟳ Task** or **◈ Product owner**) or from the prompt. Cockpit sends each cycle as a turn of its own, so each
is a flow in the Overview.

## Task: one goal, until it is achieved

`/cockpit task [$budget] [hours h] <goal>` (or `/cockpit autopilot …`, the same) sets Claude working on a goal until it
is reached. The goal gets a roadmap of its own in `.cockpit/roadmap.md`: on the first cycle Claude studies the codebase
and well-known open-source projects of the same kind and writes milestones, each with acceptance criteria a test or
command can check. A roadmap another goal left behind is kept in `.cockpit/roadmaps/`. Each cycle then takes the next
milestone: plan, build, verify with the tests and the Prover, Breaker and Reviewer, and tick it only when its criteria
pass.

- **Each cycle knows what the earlier ones did**: its prompt lists them (lines changed, files, commits) and asks it not
  to redo them. After two cycles with no milestone ticked it is told to split the milestone or take another approach.
- **It stops when the judges agree.** Claude ends each cycle with `AUTOPILOT: CONTINUE <next milestone>` or
  `AUTOPILOT: DONE <why>`. A claim of done goes to the judges with the evidence: the roadmap, the commits since the run
  began, what is uncommitted, and the end of Claude's answer. The run ends when two thirds vote Done and every
  milestone is ticked (a roadmap with no milestones is never done). Otherwise each judge's reason for Not done goes into the next cycle, which adds them as
  milestones and builds them, or shows why they are met. A second claim in a row on a finished roadmap that took in
  none of the judges' points pauses the run for you instead of arguing on.
- **Limits are yours.** A budget in dollars and a time limit, each optional: leave them out and it runs until it is
  done. The Overview's Autopilot card shows the cycle, the milestones ticked, what the judges said is missing, the
  spend and the time, with ■ Stop, and ▶ Resume when it has paused.
- **It pauses for you** on a decision it must not make (anything that publishes, pushes, deletes, merges, or touches
  settings, permissions or credentials, and a question only you can answer), after three cycles in a row that change
  nothing (a reworded next step is not a change), and when you interrupt a turn. Cycles that change code without
  ticking a milestone go on: that is work, not a stall.
  While it runs, the judges answer Claude's questions and next steps without the usual three-in-a-row limit.

## Product owner: leads the product, goal after goal

`/cockpit product [$budget] [hours h] <vision>` hands the product to a product owner. Each round:

1. **It scouts.** Claude reads `.cockpit/product.md` (the vision, what was built and why, what it learned; it keeps the
   file current), studies where the product stands (code, docs, tests, open issues) and where its field is going,
   searching the web for how similar products and well-known open-source projects are moving and what their users ask
   for. It builds nothing, and asks you nothing: it ends with two to four options,
   `PRODUCT: OPTION <goal> :: <why now>`.
2. **The judges choose.** The options go to the judges with the product owner's study; the one most of them pick is
   the next goal, a split going to the option with the most votes. You see the vote and each judge's reason in the
   Overview's Decisions.
3. **The task builds it**, as above, on a roadmap of its own. Once the judges agree it is done, the next round
   scouts again, knowing what was built. A goal that stalls is set aside, noted as such, and the next round picks
   another, so the product owner does not wait on you. Three goals set aside in a row pause it for you, as does a vote
   in which no judge gave a usable answer: then nobody chose, and nothing is built.

It runs until you stop it or a limit is hit, and needs the judges deciding (Auto, `/cockpit mode auto`). The Overview's card shows
the round, the vision, the goal being built (or that it is scouting) and how many goals were built.

## What neither does

Neither pushes, publishes, deploys, deletes branches or changes settings, permissions or credentials: a step that needs
one pauses the run for you, whatever the judges would say. Commits follow your Git settings.

[All docs](README.md) · [Project README](../README.md)
