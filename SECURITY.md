# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub: open the repository's
**Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what it could
let someone do. The maintainer aims to reply within a week, and will credit you in the release notes if you would like.

Only the latest release is supported with fixes.

## What Cockpit can do on your machine

Cockpit runs inside Claude Code with the same reach as Claude Code itself, so this is what a report would be about.

- **Runs git and gh.** Reading: `git status`, `diff`, `log`, `show`, `ls-files`, `rev-parse`, `branch`, `config`, and
  `gh auth status` and `gh api user`. Changing the repository: `git add`, `commit`, `switch` and `switch -c` (a commit on
  the base branch cuts a branch by your pattern), `init`, and `git config user.name` / `user.email` when you press
  **Use for this repo**. These happen when you press a button, or after each turn in Auto-commit mode. `git push`,
  `pull` and `gh pr create` run only when you press them or turn push and pull requests on.
- **Changes your GitHub login on this machine, when you push.** Before a push it runs `gh auth switch` to the account
  you chose (this changes the active GitHub account for the whole machine) and `gh auth setup-git` (git then asks gh for
  github.com credentials). **Add** runs `gh auth login` with a pasted token on standard input, or `gh auth login --web`;
  **Remove**, after you confirm, runs `gh auth logout` and, for the global identity, `git config --global --unset`
  of `user.name` and `user.email`.
- **Writes files.** In `.cockpit/` at the top of each repository (git-ignored by a `.gitignore` Cockpit writes there):
  its history, codebase memory and hand-off briefs. Outside it, only when you press a button in the Rules tab: the
  `settings.json` or `CLAUDE.md` you are looking at, which for **You, everywhere** are `~/.claude/settings.json` and
  `~/.claude/CLAUDE.md`. It re-reads a file before each change and refuses to overwrite a settings file it cannot parse.
  The autopilot's roadmap, `.cockpit/roadmap.md`, is written by Claude at Cockpit's request; Cockpit only reads it.
- **Keeps preferences in Claude Code's plugin store**: theme, Focus, the judges' mode, Git settings, the accounts you
  saved (a name, an email and a gh login, never a token), and the agents you made with **+ New agent**, which it also
  registers with Claude Code.
- **Sends text to a model.** A quick model (Haiku) writes each prompt's flow steps and the commit message from the
  diff, rates each decision's complexity and casts the judges' votes; a fork of the conversation (it reads the whole
  conversation) writes the short context the judges vote on; a model names the codebase's features from file names,
  their exports, first comments and imports; a model drafts an agent you describe. `/cockpit mode off` stops the
  judges' calls only.
- **Starts subagents**: the two testers after an agent's run changes files (on by default; off in the Agents tab), the
  Verify pipeline after each turn that changes files when you turn that on or when commits wait for tests, and the
  agents and pipelines you start. Every agent Cockpit defines is told never to commit, push or change settings.
- **Sends prompts as you.** In Auto mode the judges answer Claude's questions and send the winning next step as your
  next prompt, even while you are away. Questions worded as hard to undo (publishing, pushing, deleting, merging,
  settings, permissions, credentials), questions only you can answer, and splits come to you; this screening is by
  keywords, so read what the judges did in the Overview's Decisions. The autopilot sends each of its cycles as a
  prompt, and while it runs the judges' three-in-a-row limit is lifted.

Cockpit stores no credentials. A GitHub token you paste in the Git tab goes straight to `gh auth login` on standard
input, and gh keeps it in its own credential store.
