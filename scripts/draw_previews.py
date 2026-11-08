#!/usr/bin/env python3
"""Draws the previews in docs/images from the pane's own tree. It writes a throwaway test that drives Cockpit into a
representative state for each tab and prints the desktop pane's drawn tree, runs it with `claude plugin test`, removes
it, renders each tree as HTML (Box as flex boxes, Text with its colour and weight, SVG as is) and has a headless Chrome
take the picture. The test kit draws no pixels itself, so this is a likeness: the app's own spacing differs slightly.

    python3 scripts/draw_previews.py            # needs Claude Code and Google Chrome
"""
import html, json, os, re, subprocess, sys, tempfile

ROOT = os.path.realpath(os.path.join(os.path.dirname(__file__), '..'))
TEST = os.path.join(ROOT, 'cockpit', 'tests', 'zz_draw_previews.test.tsx')
CHROME = next((p for p in ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'] if os.path.exists(p)), None)

SCENES = r'''
import { expect, test } from 'claude-code/testing'

const disk: Record<string, string> = {
  '/repo/CLAUDE.md': '# Repo\n- Run the tests before saying something works\n- Keep diffs small\n@docs/style.md\n',
  '/repo/docs/style.md': 'Use two spaces.\n',
  '/repo/.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'], deny: ['Bash(rm -rf:*)'] }, hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx prettier --write "$CLAUDE_FILE_PATHS"' }] }] } }),
  '/repo/.mcp.json': JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'x' } }, docs: { type: 'http', url: 'https://docs.example.com/mcp' } } }),
  '/repo/.claude/settings.local.json': JSON.stringify({ enabledMcpjsonServers: ['github'] }),
  '/repo/.claude/skills/release/SKILL.md': '---\nname: release\ndescription: Cut a release and write its notes\n---\n',
  '/repo/.claude/skills/triage/SKILL.md': '---\nname: triage\ndescription: Sort new issues by area and urgency\ndisable-model-invocation: true\n---\n',
}
function stand(on: any) {
  let n = 0
  let clock = 1_700_000_000_000
  on('clock.now', async () => ({ value: (clock += 7000) }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.panes', async () => ({ value: [] }) as never)
  on('ui.notify', async () => ({ value: { isSent: false, reason: 'no-channel' } }) as never)
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.measure', async () => ({ changed: [] }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 52000, percent: 26, breakdown: { categories: [{ name: 'Messages', tokens: 52000 }], totalTokens: 52000 } }, rateLimits: [], cost: { usd: 0.42 } } }) as never)
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'empty-reply' } }) as never)
  on('tool.call', async () => ({ result: 'ok' }))
  on('tool.check', async () => ({ decision: 'allow' }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('command.run', async () => ({ text: '' }))
  on('prompt.submit', async (_: unknown, e: any) => ({ text: e.text }))
  on('env.get', async (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('agent.spawn', async () => ({ model: 'haiku', agentId: `ag${++n}` }))
  on('fs.exists', async (_: unknown, e: any) => ({ value: String(e.path) in disk }))
  on('fs.stat', async (_: unknown, e: any) => {
    const p = String(e.path)
    if (p in disk) return { value: { kind: 'file', size: disk[p]!.length, mtimeMs: 0, isLink: false } } as never
    if (Object.keys(disk).some(k => k.startsWith(`${p}/`))) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } as never
    throw new Error('ENOENT')
  })
  on('fs.list', async (_: unknown, e: any) => {
    const dir = `${String(e.path)}/`
    const kids = new Map<string, string>()
    for (const p of Object.keys(disk)) if (p.startsWith(dir)) { const [first, ...rest] = p.slice(dir.length).split('/'); kids.set(first!, rest.length ? 'dir' : 'file') }
    return { value: [...kids].map(([name, kind]) => ({ name, kind })) } as never
  })
  on('fs.read', async (_: unknown, e: any) => {
    if (!(String(e.path) in disk)) throw new Error('ENOENT')
    return { value: disk[String(e.path)] } as never
  })
  on('process.run', async (_: unknown, e: any) => {
    const cmd = (e.argv as string[]).join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git status')) return out('## feature/login...origin/feature/login [ahead 1]\0 M src/auth/login.ts\0 M src/auth/session.ts\0?? src/auth/limits.ts\0')
    if (cmd.startsWith('git diff --numstat')) return out('24\t6\tsrc/auth/login.ts\0' + '8\t2\tsrc/auth/session.ts\0')
    if (cmd === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (cmd === 'git rev-parse --verify -q HEAD') return out('a1b2c3d\n')
    if (cmd === 'git rev-parse --git-path cockpit-index') return out('.git/cockpit-index\n')
    if (cmd === 'git write-tree') return out('t1\n')
    if (cmd.startsWith('git commit-tree')) return out('s1\n')
    if (cmd.startsWith('git branch')) return out('main\nfeature/login\n')
    return out('', cmd.startsWith('git rev-parse --verify') ? 1 : 0)
  })
}
const pane = (w = 72) => ({ plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: w, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} } })
const dump = async ($: any, tab: string) => {
  await $.command.run({ command: 'cockpit', args: `tab ${tab}` } as never)
  const ui = await $.ui.mount(pane() as never)
  const tree = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return `@@${tab}@@${tree}@@end@@`
}
const prompt = async ($: any, text: string) => {
  await $.prompt.submit({ text, command: null, isMeta: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text, turnId: text } as never).catch(() => null)
}

test('draw the previews', { timeoutMs: 60_000 }, async ($, on) => {
  stand(on)
  await $.command.run({ command: 'cockpit', args: 'theme paper' } as never)
  await prompt($, 'Add rate limiting to the login route')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth/login.ts', old_string: 'a', new_string: 'b\nc', tool_use_id: 'e1' } as never)
  await $.turn.complete({ answer: 'done', reason: 'answer', turnId: 'Add rate limiting to the login route', isAborted: false, durationMs: 64000 } as never)
  await prompt($, 'Cover the limiter with tests')
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/auth/limits.ts', content: 'x\ny', tool_use_id: 'w1' } as never)
  await $.agent.spawn({ tool_use_id: 'a1', prompt: 'review', description: 'Reviewer', subagentType: 'cockpit:reviewer', provider: { plugin: 'cockpit', tier: 'user' }, parentModel: 'x', background: true, fork: false } as never)
  await $.agent.spawn({ tool_use_id: 'a2', prompt: 'prove', description: 'Prover', subagentType: 'cockpit:prover', provider: { plugin: 'cockpit', tier: 'user' }, parentModel: 'x', background: true, fork: false } as never)
  await $.turn.complete({ agentId: 'ag2', answer: 'CASE PASS limit after 5 tries :: 429\nCASE PASS resets after a minute :: ok\nCASE PASS other routes untouched :: ok', reason: 'answer', turnId: 'ag2', isAborted: false, durationMs: 30000 } as never)
  const shots = [await dump($, 'overview'), await dump($, 'agents'), await dump($, 'rules')]
  expect(shots.join('')).toBe('')
})
'''

def trees():
    open(TEST, 'w').write(SCENES)
    try:
        out = subprocess.run(['claude', 'plugin', 'test', os.path.join(ROOT, 'cockpit')], capture_output=True, text=True).stdout
    finally:
        os.remove(TEST)
    lit = re.search(r'Received: ("@@.*@@end@@")', out)
    if not lit:
        sys.exit('draw_previews: the scene test printed no trees:\n' + out[-2000:])
    text = json.loads(lit.group(1))
    return {m.group(1): json.loads(m.group(2)) for m in re.finditer(r'@@(\w+)@@(.*?)@@end@@', text, re.S)}

GAP = {'xs': 2, 'sm': 4, 'md': 8, 'lg': 12}
def px(v, unit=8):
    return f'{GAP[v]}px' if isinstance(v, str) and v in GAP else f'{v * unit}px' if isinstance(v, (int, float)) else '0'

def render(n):
    if isinstance(n, str):
        return html.escape(n)
    if not isinstance(n, dict):
        return ''
    t, p, kids = n.get('type'), n.get('props', {}) or {}, n.get('children', []) or []
    inner = ''.join(render(k) for k in kids)
    if p.get('display') == 'none':
        return ''
    if t == 'Box':
        st = ['display:flex', f"flex-direction:{p.get('flexDirection', 'row')}"]
        if p.get('flexWrap'): st.append('flex-wrap:wrap')
        if p.get('justifyContent'): st.append(f"justify-content:{p['justifyContent']}")
        if p.get('alignItems'): st.append(f"align-items:{p['alignItems']}")
        for k, css in [('gap', 'gap'), ('columnGap', 'column-gap'), ('rowGap', 'row-gap')]:
            if k in p: st.append(f'{css}:{px(p[k])}')
        if 'paddingX' in p: st.append(f"padding-left:{px(p['paddingX'])};padding-right:{px(p['paddingX'])}")
        if 'paddingLeft' in p: st.append(f"padding-left:{px(p['paddingLeft'])}")
        if 'marginBottom' in p: st.append(f"margin-bottom:{px(p['marginBottom'])}")
        if p.get('flexGrow'): st.append('flex-grow:1')
        if p.get('flexShrink'): st.append('flex-shrink:1;min-width:0')
        if p.get('borderStyle'): st.append(f"border:1px solid {p.get('borderColor', '#cfcac3')};border-radius:8px;padding-top:4px;padding-bottom:4px")
        if isinstance(p.get('width'), str): st.append(f"width:{p['width']}")
        return f'<div style="{";".join(st)}">{inner}</div>'
    if t == 'Text':
        st = []
        if p.get('color', '').startswith('#'): st.append(f"color:{p['color']}")
        if p.get('backgroundColor', '').startswith('#'): st.append(f"background:{p['backgroundColor']}")
        if p.get('bold'): st.append('font-weight:600')
        if p.get('size') == 'footnote': st.append('font-size:12px')
        if p.get('size') == 'heading': st.append('font-size:16px')
        if p.get('mono'): st.append('font-family:ui-monospace,Menlo,monospace;font-size:12px')
        if p.get('wrap', '').startswith('truncate'): st.append('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:inline-block')
        return f'<span style="{";".join(st)}">{inner}</span>'
    if t == 'Button':
        label = html.escape(str(p.get('label', '')))
        if kids:
            return f'<span style="cursor:pointer">{inner}</span>'
        style = 'background:#b68235;color:#fff' if p.get('variant') == 'primary' else 'background:transparent;color:#5c3d10;border:1px solid #cfcac3' if not p.get('plain') else 'color:#8a5e1e'
        return f'<span style="{style};border-radius:6px;padding:1px 8px;font-size:12px">{label}</span>'
    if t == 'Svg':
        return p.get('source', '')
    if t in ('Input', 'Select'):
        label = html.escape(str(p.get('label') or p.get('value') or ''))
        return f'<span style="border:1px solid #cfcac3;border-radius:6px;padding:1px 8px;font-size:12px;color:#6f6a63">{label}</span>'
    return inner

def shoot(name, tree):
    page = f'''<!doctype html><meta charset="utf-8"><body style="margin:0;background:#f3f2f2;color:#1d1b18;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="width:620px;padding:16px">{render(tree)}</div></body>'''
    with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False) as f:
        f.write(page)
    out = os.path.join(ROOT, 'docs', 'images', f'{name}.png')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=652,1100', f'--screenshot={out}', f'file://{f.name}'], capture_output=True, check=True)
    os.remove(f.name)
    return out

if __name__ == '__main__':
    if not CHROME:
        sys.exit('draw_previews: no Chrome found to take the pictures')
    for name, tree in trees().items():
        print('drew', shoot(name, tree))
