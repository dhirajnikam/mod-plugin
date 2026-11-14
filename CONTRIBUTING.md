# Contributing to mod-plugin

Thank you for helping. This repository holds Claude Code mods: plugins built from a hooks module. The main one is
[Cockpit](cockpit/README.md). Bug reports, ideas and pull requests are all welcome.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through the
[security policy](SECURITY.md), not public issues.

## Set up

You need Claude Code 2.1.275 or later and Node.js (for the type-check). Clone the repository, then start Claude Code
with Cockpit loaded from your checkout:

```sh
./dev.sh        # macOS and Linux
dev.cmd         # Windows
```

Saving a file under `cockpit/hooks/` reloads the mod when the current turn ends. Open the pane with `/cockpit`.

## The checks

Every change must pass all eight, run from the repository root:

```sh
claude plugin test ./cockpit                 # the tests
npx -p typescript tsc -p cockpit             # the type-check: no output means clean
claude plugin validate ./cockpit             # what the engine would refuse
python3 scripts/check_links.py               # every relative link in the Markdown resolves
python3 scripts/check_privacy.py             # every model call is documented in docs/privacy.md
python3 scripts/check_turn_undo.py           # turn undo's git commands, run on a real temporary repository
python3 scripts/check_worktrees.py           # agents in worktrees: bring back and remove, on a real repository
python3 scripts/check_release.py             # one version in plugin.json and the marketplace, a dated changelog, features described
                                             # (add --releasing when cutting a release: [Unreleased] must then be empty)
```

The type-check needs the types Claude Code writes into `cockpit/.claude-plugin/types/` (git-ignored) when it loads the
mod, so run `./dev.sh` once before it. CI runs the other seven on every push and pull request
([.github/workflows/ci.yml](.github/workflows/ci.yml)); it cannot load the mod in a session, so the type-check is yours
to run before you open a pull request.

The previews in `docs/images/` are drawn from the pane's own tree by `python3 scripts/draw_previews.py` (it needs
Google Chrome); run it after a change to the Overview, Agents or Rules tabs.

## Where things are

The [architecture guide](docs/architecture.md) explains how these fit together: the events, the state, the paths
through the code.

| Path | What it holds |
|---|---|
| `cockpit/hooks/register.tsx` | the event hooks, in order: prompts, tool calls, turns, agents, the judges |
| `cockpit/hooks/commands.ts`, `acts.ts`, `turn-io.ts` | the `/cockpit` command; the actions another plugin can call by name; a turn's start and end |
| `cockpit/hooks/core/` | the state (`core.ts`, the one file that declares it; the rest read it with `look()` and change it with `set()`), repos, history, spend, notices, text helpers, themes, the experts table (`experts.ts`) |
| `cockpit/hooks/flows/`, `git/`, `agents/`, `judges/`, `memory/`, `rules/` | one folder per feature; where a feature has the pair, `x.ts` is its pure logic and `x-io.ts` its engine I/O; `x-tab.tsx` is its tab in the pane |
| `cockpit/hooks/pane/` | the side pane: the whole pane with the open tab (`full-pane.tsx`), its header and tab row, the Overview tab, and `tabs.ts`, the one table of tabs |
| `cockpit/hooks/ui/` | `shared.tsx` for the pieces the tabs share, `svg.ts` for the SVG drawings |
| `cockpit/hooks/chat/drawings.tsx` | every drawing around the chat: the band, the spinner, the chat's cards and rows |
| `cockpit/types/index.d.ts` | the state contract: every value Cockpit keeps |
| `cockpit/agents/*.md` | the six experts' definitions |
| `cockpit/tests/` | the tests |

## Writing a change

- **Match the code around it.** Comments say why, in plain sentences; names say what. Keep diffs small.
- **Draw for every surface.** The pane draws in a terminal and in the desktop app. Use `v.ui`'s elements, the theme's
  colours (`t.text`, `t.dim`, `t.accent`, …) and `sp(v, n)` for spacing; give a desktop-only drawing (SVG) a text
  fallback. The tests render every tab on both surfaces at every width from 28 to 160 columns.
- **Never break the user's files.** Anything that writes outside `.cockpit/` reads the file again first, keeps what it
  does not change, and refuses to write a file it cannot parse.
- **Say what it sends.** A new model call gets a `// privacy: <id>` comment and a row in
  [docs/privacy.md](docs/privacy.md); the privacy check fails without them.
- **Ask before it costs or publishes.** A new model call, push or other outward action is off by default, or behind
  the judges' rules for what is hard to undo.
- **Keep the state contract.** A new value in the state is declared in `cockpit/types/index.d.ts`; make it optional
  so a session saved by an older version still loads.

## Writing a test

Tests use the engine's test kit, `claude-code/testing`, with the engine stood in: see `stand()` at the top of
`cockpit/tests/features.test.tsx`. A good test drives a feature end to end the way a person or Claude would (a prompt,
tool calls, a press in the pane) and checks what is drawn or written. Every new feature or fix gets one; a bug fix's
test fails without the fix.

## Pull requests

1. Fork the repository and branch from its default branch.
2. Make the change, with its test, and run the checks.
3. Update `cockpit/README.md` if what a person sees changes, and add a line to `CHANGELOG.md` under Unreleased.
4. Open the pull request with the template filled in. Small pull requests are reviewed fastest.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`,
`test:`, `refactor:`, `chore:`.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
