# Autopilot

`/cockpit autopilot [$budget] [hours h] <goal>`, or **⟳ Autopilot** in the Agents tab, sets Claude working on a goal for a product, its own improvement or new development, cycle after cycle until it is reached. On the first cycle Claude studies the codebase and well-known open-source projects of the same kind and writes a roadmap in `.cockpit/roadmap.md`: milestones, each with acceptance criteria a test or command can check. Each cycle then takes the next milestone: plan, build, verify with the tests and the Prover, Breaker and Reviewer, and tick it only when its criteria pass. Cockpit sends each cycle as a turn of its own, so each is a flow in the Overview.

- **It stops when the judges agree.** Claude ends each cycle with `AUTOPILOT: CONTINUE <next milestone>` or `AUTOPILOT: DONE <why>`; a claim of done goes to the judges, and the run ends only when two thirds vote Done and every milestone in the roadmap is ticked. Otherwise the next cycle carries what is missing.
- **Limits are yours.** A budget in dollars and a time limit, each optional: leave them out and it runs until it is done. The Overview's Autopilot card shows the cycle, the milestones ticked, the spend and the time, with ■ Stop, and ▶ Resume when it has paused.
- **It pauses for you** on a decision it must not make (anything that publishes, pushes, deletes, merges, or touches settings, permissions or credentials, and a question only you can answer), after three cycles in a row that change nothing, and when you interrupt a turn. While it runs, the judges answer Claude's questions and next steps without the usual three-in-a-row limit.
- It never pushes, publishes or deploys; commits follow your Git settings.

[All docs](README.md) · [Project README](../README.md)
