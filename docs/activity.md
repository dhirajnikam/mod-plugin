# Activity tab and codebase memory

What is happening, live, and how the codebase fits together. Every section has the Overview's small capitalised
heading.

> **What you see first.** The tab opens on one plain sentence of its own state ("12 edits in 4 files this session") and the live feed's latest five events. Everything else below sits behind one **› More** fold (`fold-more-activity`), folded by default; the pulse bar, feature map, features, project tree and the earlier events are inside it. Every button is still there.

## The tab, from top to bottom

- **What is happening**: the current action and the feature it is in ("Editing views.tsx in Cockpit views"), with a
  turning glyph and a light running along a bar while work runs.
- **Feature map**: the codebase's features as a diagram. What uses another feature sits above it, with an arrow to it.
  In the terminal it is drawn in characters: boxes and lines ending in ▼, the feature being worked on in a heavy box, one a
  change reaches dashed. A use that loops back up is counted under the map instead of drawn.
- **Structure**: under the map, what it shows a [restructure](overview.md#restructure) could fix: uses between
  features that close a loop, and features holding more than twelve files. **Propose a structure** asks Claude for a
  proposal aimed at those (agents research the web, nothing moves); applying it stays `/cockpit restructure agree`.
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
kept from session to session; a model names them again only on **↻ Map again**, the first time, or when over a quarter
of the files are new. Until then, or where no model can be asked, features are the folders.

- After every edit (Claude's, an agent's, or a shell command's) the file is read again. A new file joins the feature
  most of its folder is in (else the one its imports are in), and a deleted one leaves its feature, with no reload.
- **Claude reads it** every turn, as a short section of its system prompt with every feature on a line of its own and
  its page, so it can find the file to change without reading the code; **the testers get it** too: each brief lists
  the files that import the changed ones. Where another plugin's hook sends the system prompt on past Cockpit's (a
  managed security plugin may), the same lines go beside your next prompt instead, once.
- **Recall per prompt**: each prompt you send carries the features its words name (or that were worked on lately),
  at most three, with their pages and files, so Claude checks them first. A word names a feature when it is in the
  feature's name, a file's name or an export; a word found only in the sentence of what the feature does is a hint,
  and one hint alone recalls nothing, so a prompt about something else brings up no features. Files changed between turns, in your editor
  or by a checkout, join the memory when you send the next prompt.
- **It is kept in the repository** (git-ignored): `.cockpit/memory.json`, the index `.cockpit/MEMORY.md` (the codebase
  in short, one row per feature, the folders), and one page per feature in `.cockpit/memory/`, its files by folder,
  each with what it does, what it exports and imports, and what imports it.

[All docs](README.md) · [Project README](../README.md)
