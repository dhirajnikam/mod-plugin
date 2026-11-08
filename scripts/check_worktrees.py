#!/usr/bin/env python3
"""Agents in worktrees, on real git: reads the worktree commands out of cockpit/hooks/worktrees.ts and the snapshot
plan out of cockpit/hooks/turns.ts (the same data Cockpit runs), makes two worktrees whose agents work at once, brings
both back, and checks every change arrives and nothing else moves. The test kit cannot start processes, so this is
where the git commands themselves are proven."""
import json, os, re, subprocess, sys, tempfile

HOOKS = os.path.join(os.path.dirname(__file__), '..', 'cockpit', 'hooks')
def block(file, name, const):
    src = open(os.path.join(HOOKS, file), encoding='utf-8').read()
    m = re.search(r'// %s:start\s*export const %s = (.*?)// %s:end' % (name, const, name), src, re.S)
    if not m:
        sys.exit(f'check_worktrees: no {name} block in {file}')
    return json.loads(m.group(1))
WT, PLAN = block('worktrees.ts', 'wt', 'WORKTREE_COMMANDS'), block('turns.ts', 'plan', 'SNAPSHOT_PLAN')
AUTHOR = {'GIT_AUTHOR_NAME': 'Cockpit', 'GIT_AUTHOR_EMAIL': 'cockpit@localhost', 'GIT_COMMITTER_NAME': 'Cockpit', 'GIT_COMMITTER_EMAIL': 'cockpit@localhost'}
fill = lambda argv, v: [re.sub(r'\{(\w+)\}', lambda m: v.get(m.group(1), ''), a) for a in argv]

def run(cwd, argv, env=None, stdin=None, ok=False):
    r = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, input=stdin, env={**os.environ, **(env or {})})
    if r.returncode and not ok:
        sys.exit(f'check_worktrees: {" ".join(argv)} failed: {r.stderr.strip()}')
    return r

def snapshot(cwd, ref):
    v = {'ref': ref}
    for st in PLAN:
        w = st.get('when')
        if w and (bool(v.get(w[1:])) if w.startswith('!') else not v.get(w)):
            continue
        env = {**({'GIT_INDEX_FILE': v.get('index', '')} if st.get('index') else {}), **(AUTHOR if st.get('author') else {})}
        r = run(cwd, fill(st['run'], v), env, ok=st.get('optional', False))
        if 'out' in st:
            v[st['out']] = r.stdout.strip() if r.returncode == 0 else ''
    return v['commit']

def make(root, slug):
    # What Cockpit's spawn hook does: the worktree under the git folder, on its own branch, from HEAD
    base = run(root, WT['head']).stdout.strip()
    home = run(root, WT['home']).stdout.strip()
    path = os.path.join(root, home, slug) if not os.path.isabs(home) else os.path.join(home, slug)
    run(root, fill(WT['add'], {'branch': f'cockpit/{slug}', 'path': path, 'base': base}))
    return path, base

def bring_back(root, path, base, slug):
    # What Bring back does: snapshot the worktree, diff it against its base, check, then apply to the working tree
    snap = snapshot(path, f'refs/cockpit/worktrees/{slug}')
    patch = run(root, fill(WT['diff'], {'base': base, 'snap': snap})).stdout
    check = run(root, WT['check'], stdin=patch, ok=True)
    if check.returncode:
        return check.stderr
    run(root, WT['apply'], stdin=patch)
    return ''

def write(d, p, t):
    full = os.path.join(d, p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, 'w').write(t)

def files(d):
    out = {}
    for r, dirs, names in os.walk(d):
        dirs[:] = [x for x in dirs if x != '.git']
        for n in names:
            out[os.path.relpath(os.path.join(r, n), d)] = open(os.path.join(r, n)).read()
    return out

def state(root):
    return (run(root, ['git', 'write-tree']).stdout, run(root, ['git', 'rev-parse', 'HEAD']).stdout,
            run(root, ['git', 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/main']).stdout)

failures = []
def check(what, ok):
    if not ok:
        failures.append(what)

with tempfile.TemporaryDirectory() as root:
    run(root, ['git', 'init', '-q', '-b', 'main'])
    run(root, ['git', 'config', 'user.name', 'Dev']); run(root, ['git', 'config', 'user.email', 'dev@x.io'])
    for p, t in {'a.txt': 'a\n', 'b.txt': 'b\n', 'gone.txt': 'bye\n', 'shared.txt': 'one\ntwo\nthree\n'}.items():
        write(root, p, t)
    run(root, ['git', 'add', '-A']); run(root, ['git', 'commit', '-qm', 'base'])
    one, base1 = make(root, 'ag-1')
    two, base2 = make(root, 'ag-2')
    check('the worktrees are hidden from git status', run(root, ['git', 'status', '--porcelain']).stdout == '')
    # The two agents at once, in their own trees: edit, create, delete; and your own work in yours meanwhile
    write(one, 'a.txt', 'a by agent one\n'); write(one, 'src/one.ts', 'new from one\n'); os.remove(os.path.join(one, 'gone.txt'))
    write(two, 'b.txt', 'b by agent two\n'); write(two, 'docs/two.md', 'new from two\n')
    write(root, 'mine.txt', 'my own work\n')
    state0 = state(root)
    check('agent one comes back', bring_back(root, one, base1, 'ag-1') == '')
    check('agent two comes back', bring_back(root, two, base2, 'ag-2') == '')
    got = files(root)
    check('every change arrived', got.get('a.txt') == 'a by agent one\n' and got.get('src/one.ts') == 'new from one\n' and 'gone.txt' not in got
          and got.get('b.txt') == 'b by agent two\n' and got.get('docs/two.md') == 'new from two\n')
    check('your own work and the untouched files stay', got.get('mine.txt') == 'my own work\n' and got.get('shared.txt') == 'one\ntwo\nthree\n')
    check('the index, HEAD and the branch are unchanged', state(root) == state0)
    # A clash: a third agent edits shared.txt, which you changed meanwhile; refused, naming it, nothing changed
    three, base3 = make(root, 'ag-3')
    write(three, 'shared.txt', 'one\nTWO by agent\nthree\n'); write(three, 'c.txt', 'also new\n')
    write(root, 'shared.txt', 'one\ntwo edited by you\nthree\n')
    before = files(root)
    err = bring_back(root, three, base3, 'ag-3')
    check('a clashing bring-back is refused, naming the file', 'shared.txt' in err)
    check('a refused bring-back changes no file', files(root) == before)
    # Remove: the worktree goes, its branch stays
    run(root, fill(WT['remove'], {'path': three}))
    check('a removed worktree is gone', not os.path.exists(three) and three not in run(root, ['git', 'worktree', 'list']).stdout)
    check('its branch is kept', run(root, ['git', 'rev-parse', '--verify', '-q', 'refs/heads/cockpit/ag-3'], ok=True).returncode == 0)

if failures:
    print('Agents in worktrees on real git failed:\n- ' + '\n- '.join(failures))
    sys.exit(1)
print('Agents in worktrees work on real git: two at once brought back, a clash refused, a removed worktree keeps its branch.')
