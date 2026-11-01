# Activity tab and codebase memory

What is happening, live, and how the codebase fits together. Every section has the Overview's small capitalised
heading.

## The tab, from top to bottom

- **What is happening**: the current action and the feature it is in ("Editing views.tsx in Cockpit views"), with a
  turning glyph and a light running along a bar while work runs.
- **Feature map**: the codebase's features as a diagram. What uses another feature sits above it, with an arrow to it.
  The feature being worked on this moment is filled and breathes, the ones changed this flow are outlined in gold, the
  ones the last change reaches are dashed, and the arrows between them are lit; the rest are faint, and an arrow
  another path already implies is left out. Hovering a box says what the feature does. Test-only features are counted
  under the map instead of drawn, as they import everything. A terminal draws the same map as layered text.
- **Impact** of the file chosen in the tree, or else the one edited last: its feature, what it uses, what imports it,
  and the files a change to it reaches, by name, to check.
- **Features**, folded to the ones in the work; open, every feature with what it does, its files (each with what it
  imports → and what imports it ←) and the features it uses and is used by. ↻ Map again maps and names them again.
- **Project**, folded to the files touched; open, the whole tree (git's view of it, ignored files left out), the file
  being worked on marked `▶ … now`.
- **Feed**, newest first: every file read, written, edited, deleted or searched (its diff a press away) and what each
  agent is doing, each line with its age. Pressing a file in the tree narrows the feed to it.

## Codebase memory

At each session start Cockpit maps the repository: every source file (TypeScript, JavaScript, Dart, CSS, Python and
the like), the files it imports and the files that import it. A model then names the product's **features** from what
each file exports and its first comment (for example "Hero section", "Contact form", "Commit flow"), each with one
sentence on what it does; the links between features come from the real imports between their files. The names are
written again only when files are added or removed; until then, or where no model can be asked, features are the
folders.

- After every edit (Claude's, an agent's, or a shell command's) the file is read again.
- **Claude reads it** every turn, as a short section of its system prompt, and **the testers get it**: each brief
  lists the files that import the changed ones.
- **It is kept in the repository** as `.cockpit/memory.json` and a readable `.cockpit/MEMORY.md` (git-ignored).

[All docs](README.md) · [Project README](../README.md)
