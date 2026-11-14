# Decisions by judges

Claude asks you things two ways: its question box in the middle of a turn, and the **next-step box** with reply buttons at the end of one. The judges take both. A quick model rates each decision from 0 to 10 for complexity: 0–3 gets 3 judges, 4–6 gets 6, 7–10 gets 9, each with its own point of view, and one option needs two thirds of the votes.

- **Auto · judge** (the default): a clear winner answers for you. A question gets that answer; a next step gets its winning reply sent as your next prompt, marked as the judges' choice in the chat. A decision that publishes, pushes, deletes, merges, sends or is otherwise hard to undo, a split, a button only you can press (an app action), and a fourth answer in a row with no prompt of yours in between all come to you, with what the judges recommend.
  Settings, permissions, rules and credentials count as hard to undo too. A question only you can answer is never judged: what you saw, did or want ("did ▶ start the agent?"), which of the things you asked for comes first ("Which … should I build first?"), what you want or prefer ("Want it bigger, or is this the right size?"), what only you can do ("Will you take the screenshots?"), and anything about the judges themselves. Neither is a decision with a reply that needs your own words ("Tweak it first", "Something else"). An answer that arrives after a newer question or a prompt of yours is dropped, not sent.
  Each judge has its own point of view: a pragmatic senior engineer, a security reviewer, a long-term maintainer, the end user, a sceptic, a performance engineer, a test engineer, an architect and a minimalist, seated in that order. Each answers with its pick and a one-line reason, judging from the facts it is given rather than how sure a claim sounds; open a decision in the Overview's Decisions to read every judge's reason beside its vote. A judge whose reply names no option abstains (– in the Overview); it never counts for the first option.
- **For the autopilot** the judges weigh evidence, not a summary of the conversation: a claim of done comes with the roadmap, the commits since the run began, the uncommitted changes and the end of Claude's answer, and the reasons of those who voted Not done go into the next cycle as what is missing. The product owner's next goal is theirs alone: they choose from its options, and a split goes to the option with the most votes. See [Autopilot](autopilot.md).
- **Ask me**: every decision is yours. The judges still vote and say what they recommend: above the prompt (⚖), in the chat for a next step, and in the Overview beside what you chose.
- **Off**: no judges and no model calls for them.

Switch in the Overview's Decisions card or with `/cockpit mode auto|ask|off`; the choice is kept across sessions.

**Judge models**: the judges vote on Haiku, the quickest model. `judgeModels` in `/config` (or on the install screen) puts bigger models on some seats: `mixed` seats Haiku and Sonnet in turn, `wide` Haiku, Sonnet and Opus. That is slower and costs more, but the panel no longer shares one model's blind spots.

**Faster judging**: the summary the judges read is written while the decision's complexity is scored, not after it.

**Decisions card**: open a decision in the Overview to see each option's share of the panel as a bar (★ once it clears two thirds) and every judge on a row of its own with its model, its pick and its reason.

[All docs](README.md) · [Project README](../README.md)
