# Git

The tab shows the branch with what is unpushed and unpulled, and **↓ Pull** and **↑ Push** buttons only when there is something to pull or push; the next commit as a card (type, message, branch, files, Commit) and the changes with their kind (new, deleted, renamed, edited) and ticks, only while there are changes (a clean tree says so in one line, and Commit shows only with a file ticked); the **history as a git graph** of every branch, remote and tag: each commit a dot on its lane, lines carrying the lanes down, a merge opening a lane and a branch joining one, each lane its own colour; refs as chips on their commit (HEAD's branch filled, local branches tinted, remotes ☁ and tags ⌑), unpushed commits hollow, Cockpit's own marked ✦, and a press opens a commit's author, date, message and changed files. Desktop draws the graph as SVG, the terminal with line characters. The account, patterns and options are folded away.

## Setup and commits

The first time you open the Git tab in a repository it asks five things, once: the **account** that commits, the **branch pattern**, the **message pattern**, the **commit mode**, and **when**. **⚙ Setup** asks again; **Patterns & options** edits any of it. Everything is remembered per repository.

- **Commit mode**: *Auto-commit* commits by itself, after each turn that changed the repository's files however they were changed (Edit and Write, a shell command, a script) and after each agent run that changed files, then pushes when **Push after commit** is on; *Ask me* proposes each commit above the prompt and in the pane, with Commit and Skip; *Manual* commits only when you press the button.
- **Type, message and branch are written from the changes, not from your prompt.** A quick model reads the diff of the ticked files (and the start of each new file) and writes the commit type (feat, fix, docs, refactor, perf, test, chore) and the subject, again whenever the ticked files change; the branch kind (feature, fix, docs, …) and the branch's name follow them. When the work sits on a base branch (main, master, develop, trunk) a branch is cut by the pattern, e.g. `feature/add-login`; on any other branch the commit stays there. In Manual mode you pick the type.
- The Next commit card shows the message before anything happens ("writing from the diff…" while the model works); Commit, Ask me and Auto-commit wait for it. If no model answers, the subject names the files changed.
- **Commit** commits the ticked files only, even ones you had already staged with `git add`. A rename is committed whole.
- The tab reads the repository and the accounts each time you open it (the repository after every turn too, the accounts every 15 s while the account box shows); **↻ Refresh** reads both again. A login whose token stopped working is named in the account box.
- **Open pull request** needs a branch other than the base, which the pattern gives you.
- Failed pushes, PRs and commits say why in the toast.
- Git runs from the repository's top folder, and the settings and account are kept per repository, so a session working in a subfolder commits the right paths with the same settings.

## Accounts

The **Account** box shows the saved login; **Modify** opens the choices and the ways to add one. It lists your global git identity (pushing as the gh login of the same name, else gh's active one) and each other GitHub login `gh auth status` reports, with its GitHub name and no-reply address.

- **Add** puts the login on this machine. Paste a classic personal access token with the `repo` and `read:org` scopes (**Add token** hands it to `gh auth login --with-token` on stdin; gh keeps it, Cockpit does not), or press **Log in with gh**: gh copies a one-time code to your clipboard, the box shows the code too, and gh waits for you at github.com/login/device. Either way Cockpit then runs `gh auth setup-git` and picks the new login.
- **Remove** takes it off this machine, after you confirm: `gh auth logout` for its login, and for the global identity `git config --global --unset user.name` and `user.email` as well. ↻ Detect does not bring it back. (Logging out does not revoke the token on GitHub.)
- Commits use the chosen account's name and email. With push on, and for ↑ Push, Cockpit first runs `gh auth switch` to that account's login (which changes the active GitHub account for the whole machine) and `gh auth setup-git`, so git asks gh for github.com's credentials instead of a helper such as Windows' credential manager that would push as whoever it remembers. **Use for this repo** writes the identity into the repository's own git config.

[All docs](README.md) · [Project README](../README.md)
