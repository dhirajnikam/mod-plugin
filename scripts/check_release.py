#!/usr/bin/env python3
"""The release is consistent: the plugin and its marketplace entry carry one version, the CHANGELOG's newest numbered
section is that version with a date, and every feature that section names in bold is described in the README or the
docs. Claude Code sends a plugin update only when the version changes, so this is what a release must get right.
Between releases [Unreleased] fills up, as it should; `--releasing` (when cutting one) also requires it empty.

    python3 scripts/check_release.py              # always, in CI
    python3 scripts/check_release.py --releasing  # when cutting a release
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), '..')
read = lambda p: open(os.path.join(ROOT, p), encoding='utf-8').read()

plugin = json.loads(read('cockpit/.claude-plugin/plugin.json')).get('version', '')
market = next((p.get('version', '') for p in json.loads(read('.claude-plugin/marketplace.json')).get('plugins', []) if p.get('name') == 'cockpit'), '')
log = read('CHANGELOG.md')
problems = []

if not plugin or plugin != market:
    problems.append(f'plugin.json says {plugin or "nothing"} and marketplace.json says {market or "nothing"}')
sections = re.findall(r'^## \[([^\]]+)\](.*)$', log, re.M)
numbered = [(v, rest) for v, rest in sections if v != 'Unreleased']
if not numbered:
    problems.append('the CHANGELOG has no numbered section')
else:
    newest, rest = numbered[0]
    if newest != plugin:
        problems.append(f'the newest CHANGELOG section is {newest}, not {plugin}')
    if not re.search(r'\d{4}-\d{2}-\d{2}', rest):
        problems.append(f'the {newest} section has no date')
unreleased = re.search(r'^## \[Unreleased\]\n(.*?)(?=^## \[)', log, re.M | re.S)
if '--releasing' in sys.argv and unreleased and re.search(r'^- ', unreleased.group(1), re.M):
    problems.append('[Unreleased] still has entries')

# Every feature the newest section names in bold is described somewhere a person reads
if numbered:
    body = re.search(r'^## \[%s\].*?\n(.*?)(?=^## \[|\Z)' % re.escape(numbered[0][0]), log, re.M | re.S)
    names = re.findall(r'^- \*\*([^*]+)\*\*', body.group(1) if body else '', re.M)
    docs = read('README.md') + ''.join(read(os.path.join('docs', f)) for f in os.listdir(os.path.join(ROOT, 'docs')) if f.endswith('.md'))
    for n in names:
        if n.lower() not in docs.lower():
            problems.append(f'"{n}" is in the changelog but not in the README or the docs')

if problems:
    print('The release is not ready:\n- ' + '\n- '.join(problems))
    sys.exit(1)
print(f'Release {plugin} is consistent: one version, a dated changelog section, every feature described' + (', nothing unreleased.' if '--releasing' in sys.argv else '.'))
