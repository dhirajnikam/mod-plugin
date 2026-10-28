# mod-plugin

Claude Code mods (plugins built from hooks modules).

| Folder | What |
|---|---|
| `cockpit/` | **Cockpit**: progress, context, judges, testers, agents and git around the prompt and in a side pane. See `cockpit/README.md`. |
| `ui-template/` | A small earlier mod: a clean spinner and a mode · model · effort line under the prompt. |
| `design/` | The "Powerhouse Mod v2" design Cockpit is built from (open the HTML in a browser). |
| `dev.cmd` | Starts Claude Code here with Cockpit loaded; saving a file under `cockpit/hooks` reloads it. |

Load only one of `cockpit` and `ui-template` at a time: both replace the spinner and the line under the prompt.

## Checks

```
claude plugin validate cockpit
claude plugin test cockpit
npx -p typescript tsc -p cockpit
```

`cockpit/.claude-plugin/types/` is written by Claude Code when it loads the mod, and is git-ignored.
