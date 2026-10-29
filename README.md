# mod-plugin

Claude Code mods (plugins built from hooks modules), open source under the MIT license.

## Install Cockpit

Requires Claude Code 2.1.275 or later. At the prompt of a Claude Code session, type:

```
/plugin install cockpit --marketplace dhirajnikam/mod-plugin
```

Answer `y` to add this repository as a marketplace, then pick a scope: for you everywhere, or for one project. Cockpit loads at once; `/cockpit` opens its pane. Later versions arrive with `claude plugin update cockpit`.

**Good to know before you turn it on**

- Cockpit writes a `.cockpit/` folder at the top of each repository you use it in: its codebase memory and history. The folder carries its own `.gitignore`, so nothing in it is ever committed.
- Testing each agent's work is on: every agent run that edits files starts two more subagents (a positive and a negative tester). Switch it off in the Agents tab.
- Each prompt makes one small model call to write its own flow steps, and the judges make a few when Claude asks a question in Auto mode (switch to Ask me in the Overview to stop them).
- Push, pull requests and Verify after each turn are off until you turn them on.
- Plugins your organization manages may run before Cockpit and skip some of its hooks; Cockpit's other parts keep working.

## What is here

| Folder | What |
|---|---|
| `cockpit/` | **Cockpit**: progress by flow, codebase memory with impact, agents with positive and negative testers, judges, and a git graph, around the prompt and in a side pane. See `cockpit/README.md`. |
| `ui-template/` | A small earlier mod: a clean spinner and a mode · model · effort line under the prompt. |
| `design/` | The "Powerhouse Mod v2" design Cockpit is built from (open the HTML in a browser). |
| `dev.sh` / `dev.cmd` | Start Claude Code here with Cockpit loaded (macOS/Linux / Windows); saving a file under `cockpit/hooks` reloads it. |

Load only one of `cockpit` and `ui-template` at a time: both replace the spinner and the line under the prompt.

## Develop

Clone the repository and run `./dev.sh` (macOS, Linux) or `dev.cmd` (Windows) to start Claude Code with Cockpit loaded from `cockpit/`; saving a file there reloads it.

## Checks

```
claude plugin validate cockpit
claude plugin test cockpit
npx -p typescript tsc -p cockpit
```

`cockpit/.claude-plugin/types/` is written by Claude Code when it loads the mod, and is git-ignored.

## License

MIT, see [LICENSE](LICENSE).
