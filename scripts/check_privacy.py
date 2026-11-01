#!/usr/bin/env python3
"""Checks that every model call Cockpit makes is documented in docs/privacy.md.

Each `$.model` call in cockpit/hooks/ must have a `// privacy: <id>` comment on one of the three lines above it, and
docs/privacy.md must have a row naming that id in backquotes. The doc may not name an id the code no longer uses.
Run from anywhere: python3 scripts/check_privacy.py. Exits 1 and says what is missing.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CALL = re.compile(r"\$\.model\b")
MARK = re.compile(r"//\s*privacy:\s*([a-z0-9-]+)")


def code_ids():
    ids, unmarked = set(), []
    for src in sorted((ROOT / "cockpit" / "hooks").rglob("*.ts*")):
        lines = src.read_text(encoding="utf-8").splitlines()
        for n, line in enumerate(lines):
            # A call, not a mention in a comment
            if not CALL.search(line.split("//")[0]):
                continue
            above = [MARK.search(l) for l in lines[max(0, n - 3):n]]
            found = [m.group(1) for m in above if m]
            if found:
                ids.add(found[-1])
            else:
                unmarked.append(f"{src.relative_to(ROOT)}:{n + 1}")
    return ids, unmarked


def doc_ids():
    text = (ROOT / "docs" / "privacy.md").read_text(encoding="utf-8")
    # The ids are the first cell of the model-call table's rows: | `id` | …
    return set(re.findall(r"^\|\s*`([a-z0-9-]+)`\s*\|", text, re.M))


if __name__ == "__main__":
    ids, unmarked = code_ids()
    documented = doc_ids()
    problems = [f"{u}: a model call with no `// privacy: <id>` comment above it" for u in unmarked]
    problems += [f"docs/privacy.md: no row for `{i}`, a model call in the code" for i in sorted(ids - documented)]
    problems += [f"docs/privacy.md: a row for `{i}`, which no model call in the code has" for i in sorted(documented - ids)]
    for p in problems:
        print(p)
    print(f"{len(problems)} problem{'' if len(problems) == 1 else 's'}" if problems else f"All {len(ids)} model calls are documented.")
    sys.exit(1 if problems else 0)
