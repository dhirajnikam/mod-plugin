#!/usr/bin/env python3
"""Checks every relative link in the repository's Markdown files: each must point at a file or folder that exists.

Run from anywhere: python3 scripts/check_links.py. Exits 1 and lists the broken links when any are found.
Web links (http, https, mailto) and same-page anchors (#...) are not checked.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP = {".git", ".cockpit", "node_modules", ".claude-plugin"}
# [text](target) and ![alt](target), the target up to a space or the closing parenthesis
LINK = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")


def links(md: pathlib.Path):
    in_code = False
    for n, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
        # Links inside fenced code blocks are examples, not links
        if line.lstrip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        for target in LINK.findall(re.sub(r"`[^`]*`", "", line)):
            yield n, target


def broken():
    for md in sorted(ROOT.rglob("*.md")):
        if SKIP & set(md.relative_to(ROOT).parts):
            continue
        for n, target in links(md):
            if re.match(r"^(https?:|mailto:|#)", target):
                continue
            path = target.split("#")[0].split("?")[0]
            if path and not (md.parent / path).exists():
                yield f"{md.relative_to(ROOT)}:{n}: {target}"


if __name__ == "__main__":
    bad = list(broken())
    for b in bad:
        print(b)
    print(f"{len(bad)} broken link{'' if len(bad) == 1 else 's'}" if bad else "All relative links resolve.")
    sys.exit(1 if bad else 0)
