#!/usr/bin/env python3
"""Turn undo, on real git: reads the snapshot plan and the undo commands out of cockpit/hooks/turns.ts (the same data
Cockpit runs), then in a temporary repository makes a turn's changes the way a shell command or subagent would,
undoes the turn, and checks every file, the index, HEAD and the branches are as they were. The test kit cannot start
processes, so this is where the git commands themselves are proven."""
import json, os, re, subprocess, sys, tempfile

SRC = open(os.path.join(os.path.dirname(__file__), '..', 'cockpit', 'hooks', 'turns.ts'), encoding='utf-8').read()
def block(name, const):
    m = re.search(r'// %s:start\s*export const %s = (.*?)// %s:end' % (name, const, name), SRC, re.S)
    if not m:
        sys.exit(f'check_turn_undo: no {name} block in turns.ts')
    return json.loads(m.group(1))
PLAN, UNDO = block('plan', 'SNAPSHOT_PLAN'), block('undo', 'UNDO_COMMANDS')
AUTHOR = {'GIT_AUTHOR_NAME': 'Cockpit', 'GIT_AUTHOR_EMAIL': 'cockpit@localhost', 'GIT_COMMITTER_NAME': 'Cockpit', 'GIT_COMMITTER_EMAIL': 'cockpit@localhost'}
LITERAL = {'GIT_LITERAL_PATHSPECS': '1'}

def git(repo, argv, env=None, ok=False):
    r = subprocess.run(argv, cwd=repo, capture_output=True, text=True, env={**os.environ, **(env or {})})
    if r.returncode and not ok:
        sys.exit(f'check_turn_undo: {" ".join(argv)} failed: {r.stderr.strip()}')
    return r

def snapshot(repo, ref):
    # The runner of cockpit/hooks/turns.ts, step for step
    v = {'ref': ref}
    fill = lambda x: re.sub(r'\{(\w+)\}', lambda m: v.get(m.group(1), ''), x)
    for st in PLAN:
        w = st.get('when')
        if w and (bool(v.get(w[1:])) if w.startswith('!') else not v.get(w)):
            continue
        env = {**({'GIT_INDEX_FILE': v.get('index', '')} if st.get('index') else {}), **(AUTHOR if st.get('author') else {})}
        r = git(repo, [fill(a) for a in st['run']], env, ok=st.get('optional', False))
        if 'out' in st:
            v[st['out']] = r.stdout.strip() if r.returncode == 0 else ''
    return v['commit']

def git_in(repo, argv, env, stdin):
    r = subprocess.run(argv, cwd=repo, capture_output=True, text=True, input=stdin, env={**os.environ, **env})
    if r.returncode:
        sys.exit(f'check_turn_undo: {" ".join(argv)} failed: {r.stderr.strip()}')
    return r

def undo(repo, before, after):
    # undoTurn of cockpit/hooks/turns.ts, in its order: read the changes, keep now, refuse if stale, git clean what the
    # turn created that nothing tracks and the folders that leaves empty, then restore the rest with the tracked ones
    fill = lambda argv, v: [re.sub(r'\{(\w+)\}', lambda m: v[m.group(1)], a) for a in argv]
    parts = [p for p in git(repo, fill(UNDO['changed'], {'before': before, 'after': after})).stdout.split('\0') if p]
    restore, remove = [], []
    for code, path in zip(parts[0::2], parts[1::2]):
        (remove if code.startswith('A') else restore).append(path)
    if not restore and not remove:
        return []
    now = snapshot(repo, 'refs/cockpit/turns/t/undone')
    mine = set(restore + remove)
    stale = [p for p in git(repo, fill(UNDO['since'], {'after': after, 'now': now})).stdout.split('\0') if p and p in mine]
    if stale:
        return stale
    tracked = set(git(repo, UNDO['tracked']).stdout.split('\0'))
    untracked = [p for p in remove if p not in tracked]
    for i in range(0, len(untracked), 100):
        git(repo, UNDO['clean'] + untracked[i:i + 100], LITERAL)
    dirs = sorted({'/'.join(p.split('/')[:i + 1]) for p in remove for i in range(len(p.split('/')) - 1)}, key=len, reverse=True)
    for d in dirs:
        full = os.path.join(repo, d)
        if os.path.isdir(full) and not os.listdir(full):
            git(repo, UNDO['cleanDir'] + [d + '/'], LITERAL)
    back = restore + [p for p in remove if p in tracked]
    if back:
        git_in(repo, fill(UNDO['restore'], {'before': before}), LITERAL, '\0'.join(back))
    return []

def files(repo):
    # Every file with its bytes, and every folder (so one left empty shows)
    out = {}
    for root, dirs, names in os.walk(repo):
        dirs[:] = [d for d in dirs if d != '.git']
        for d in dirs:
            out[os.path.relpath(os.path.join(root, d), repo) + '/'] = b''
        for n in names:
            p = os.path.join(root, n)
            out[os.path.relpath(p, repo)] = open(p, 'rb').read()
    return out

def state(repo):
    return (git(repo, ['git', 'write-tree']).stdout, git(repo, ['git', 'rev-parse', 'HEAD']).stdout, git(repo, ['git', 'for-each-ref', 'refs/heads']).stdout)

def write(repo, path, text):
    p = os.path.join(repo, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(text)

failures = []
def check(what, ok):
    if not ok:
        failures.append(what)

with tempfile.TemporaryDirectory() as repo:
    git(repo, ['git', 'init', '-q'])
    git(repo, ['git', 'config', 'user.name', 'Dev']); git(repo, ['git', 'config', 'user.email', 'dev@x.io'])
    for p, t in {'a.txt': 'one\n', 'gone.txt': 'bye\n', 'old/name.txt': 'moved\n', 'star*.txt': 'literal\n', '.gitignore': 'ignored/\n'}.items():
        write(repo, p, t)
    git(repo, ['git', 'add', '-A']); git(repo, ['git', 'commit', '-qm', 'base'])
    # Staged and unstaged work already there, an untracked file and an ignored one: none of it the turn's
    write(repo, 'a.txt', 'one\nstaged\n'); git(repo, ['git', 'add', 'a.txt'])
    write(repo, 'a.txt', 'one\nstaged\nunstaged\n')
    write(repo, 'notes.txt', 'mine\n'); write(repo, 'ignored/cache.bin', 'cache\n')
    files0, state0 = files(repo), state(repo)
    before = snapshot(repo, 'refs/cockpit/turns/t/before')
    check('a snapshot leaves files, index, HEAD and branches as they were', files(repo) == files0 and state(repo) == state0)
    # The turn, as a shell command or subagent would make it: edit, create, delete, rename, a name with *
    write(repo, 'a.txt', 'rewritten by the turn\n'); write(repo, 'src/new.ts', 'created\n')
    os.remove(os.path.join(repo, 'gone.txt')); os.makedirs(os.path.join(repo, 'new'), exist_ok=True)
    os.rename(os.path.join(repo, 'old/name.txt'), os.path.join(repo, 'new/name.txt')); write(repo, 'star*.txt', 'changed\n')
    after = snapshot(repo, 'refs/cockpit/turns/t/after')
    check('undo goes through', undo(repo, before, after) == [])
    check('every file is back as it was, untracked and ignored ones kept', files(repo) == files0)
    check('the index, HEAD and branches are unchanged', state(repo) == state0)
    check('the refs are Cockpit own', 'refs/cockpit/turns/t/before' in git(repo, ['git', 'for-each-ref', 'refs/cockpit']).stdout)
    # A turn whose file was edited again after it ended: refused, nothing changed
    before2 = snapshot(repo, 'refs/cockpit/turns/u/before')
    write(repo, 'a.txt', 'turn two\n')
    after2 = snapshot(repo, 'refs/cockpit/turns/u/after')
    write(repo, 'a.txt', 'edited by hand later\n')
    files_late = files(repo)
    check('a stale undo is refused, naming the file', undo(repo, before2, after2) == ['a.txt'])
    check('a refused undo changes nothing', files(repo) == files_late)

with tempfile.TemporaryDirectory() as repo:
    # A file that becomes a folder, and a folder that becomes a file
    git(repo, ['git', 'init', '-q'])
    write(repo, 'x', 'a file\n'); write(repo, 'd/inner.txt', 'in a folder\n')
    files0 = files(repo)
    before = snapshot(repo, 'refs/cockpit/turns/s/before')
    os.remove(os.path.join(repo, 'x')); write(repo, 'x/now-a-folder.txt', 'folder\n')
    os.remove(os.path.join(repo, 'd/inner.txt')); os.rmdir(os.path.join(repo, 'd')); write(repo, 'd', 'now a file\n')
    after = snapshot(repo, 'refs/cockpit/turns/s/after')
    check('a file that became a folder, and a folder a file, come back', undo(repo, before, after) == [] and files(repo) == files0)

with tempfile.TemporaryDirectory() as repo:
    # What the turn created was auto-committed afterwards, so it is tracked: undo still takes it away
    git(repo, ['git', 'init', '-q'])
    git(repo, ['git', 'config', 'user.name', 'Dev']); git(repo, ['git', 'config', 'user.email', 'dev@x.io'])
    write(repo, 'keep.txt', 'k\n'); git(repo, ['git', 'add', '-A']); git(repo, ['git', 'commit', '-qm', 'base'])
    files0 = files(repo)
    before = snapshot(repo, 'refs/cockpit/turns/c/before')
    write(repo, 'made/by/turn.txt', 'new\n'); write(repo, 'keep.txt', 'changed\n')
    after = snapshot(repo, 'refs/cockpit/turns/c/after')
    git(repo, ['git', 'add', '-A']); git(repo, ['git', 'commit', '-qm', 'auto-commit'])
    check('a turn already auto-committed is undone in the working tree, created files and their folders gone', undo(repo, before, after) == [] and files(repo) == files0)

with tempfile.TemporaryDirectory() as repo:
    # A repository with no commit yet
    git(repo, ['git', 'init', '-q'])
    write(repo, 'first.txt', 'hello\n')
    files0 = files(repo)
    before = snapshot(repo, 'refs/cockpit/turns/f/before')
    write(repo, 'first.txt', 'changed\n'); write(repo, 'second.txt', 'new\n')
    after = snapshot(repo, 'refs/cockpit/turns/f/after')
    check('undo works before the first commit', undo(repo, before, after) == [] and files(repo) == files0)
    check('no branch was made', git(repo, ['git', 'for-each-ref', 'refs/heads']).stdout == '')

if failures:
    print('Turn undo on real git failed:\n- ' + '\n- '.join(failures))
    sys.exit(1)
print('Turn undo works on real git: snapshot, undo, refusal, and a repository with no commit.')
