
import type { McpRow } from '../../types'
import type { $ } from '../core/core'
import { setUi } from '../core/core'
import { parseSettings, hookRows, permRows, ruleLines, HOOK_EVENTS, changeHook, PERM_KINDS, changePerm, changeRule } from './rules'
import { kTok, plural } from '../core/text'
import { loadRules, writeSkill, writeSettings, writeMcp, writeInstructions } from './rules-io'
import type { PermKind } from './rules'
import type { V } from '../ui/shared'
import { grow, sp, Seg, More, Head } from '../ui/shared'

// Rules: the hooks, permission rules and instructions Claude Code follows, for this repository or for you everywhere.
// Each is a row to edit in place or delete (after you confirm); each section has an add form. Every change is written
// back to its file with the rest of the file kept; a settings file that is not valid JSON is shown, never written
export function Rules($: $, v: V) {
  const { Box, Button, Input, Select, Text } = v.ui
  const { s, t } = v
  const scope = s.ui.ruleScope ?? 'repo'
  const f = s.rules?.[scope]
  const clear = { ruleEdit: '', ruleDel: '', ruleAdd: '', ruleA: '', ruleB: '', ruleC: '' }
  // Enter submits with the text as typed: the drawing it was typed into may not have it yet
  const field = (key: 'ruleA' | 'ruleB' | 'ruleC', label: string, placeholder: string, onSubmit: (val: string) => unknown) => (
    <Input key={`rf-${key}`} label={label} placeholder={placeholder} value={s.ui[key] ?? ''} rows={grow(v, s.ui[key], label)} submitLabel={s.ui.ruleEdit ? 'save' : 'add'} onInput={val => setUi($, { [key]: val })} onSubmit={val => onSubmit(val)} />
  )
  const actions = (key: string, onEdit: () => unknown, onDelete: () => unknown) =>
    s.ui.ruleDel === key ? (
      <Box columnGap={sp(v, 1)}>
        <Text color={t.bad} size="footnote">Delete?</Text>
        <Button key={`rdy-${key}`} plain onPress={() => onDelete()}>
          <Text color={t.bad} size="footnote">Delete</Text>
        </Button>
        <Button key={`rdn-${key}`} plain onPress={() => setUi($, { ruleDel: '' })}>
          <Text color={t.dim} size="footnote">Keep</Text>
        </Button>
      </Box>
    ) : (
      <Box columnGap={sp(v, 1)}>
        <Button key={`re-${key}`} plain onPress={() => onEdit()}>
          <Text color={t.faint}>✎</Text>
        </Button>
        <Button key={`rd-${key}`} plain onPress={() => setUi($, { ruleDel: key })}>
          <Text color={t.faint}>✕</Text>
        </Button>
      </Box>
    )
  const save = (p: Promise<unknown>) => p.then(() => setUi($, clear))
  const head = (label: string, n: number, add: string, path: string) => (
    <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)}>
      <Head v={v} label={label} n={n} note={path} />
      {add !== '' && <Button key={`radd-${add}`} plain onPress={() => setUi($, { ...clear, ruleAdd: s.ui.ruleAdd === add ? '' : add, ruleA: add === 'hook' ? 'PreToolUse' : add === 'perm' ? 'allow' : '' })}>
        <Text color={t.accent} size="footnote">{s.ui.ruleAdd === add ? '✕ Close' : '+ Add'}</Text>
      </Button>}
    </Box>
  )
  if (!f) return <Text color={t.dim}>Reading the rules…</Text>
  // Each add form: Enter adds the text as typed, the button the text the state holds; nothing typed adds nothing
  const addHook = (val = s.ui.ruleC ?? '') => (val.trim() ? save(writeSettings($, scope, j => changeHook(j, { add: { event: s.ui.ruleA || 'PreToolUse', matcher: (s.ui.ruleB ?? '').trim(), command: val.trim() } }), 'Hook added')) : undefined)
  const addPerm = (val = s.ui.ruleB ?? '') => (val.trim() ? save(writeSettings($, scope, j => changePerm(j, { add: { kind: (s.ui.ruleA || 'allow') as PermKind, rule: val.trim() } }), 'Rule added')) : undefined)
  const addMcp = (val = s.ui.ruleB ?? '') => (val.trim() ? save(writeMcp($, { add: { name: (s.ui.ruleA ?? '').trim(), target: val.trim() } }, 'Server added')) : undefined)
  const addRule = (val = s.ui.ruleB ?? '') => (val.trim() ? save(writeInstructions($, scope, md => changeRule(md, { add: val.trim() }), 'Instruction added')) : undefined)
  const settingsName = f.settingsPath.replace(/^.*\/(\.claude\/)/, '$1')
  const { json, error } = parseSettings(f.settings)
  const hooks = hookRows(json)
  const perms = permRows(json)
  const lines = ruleLines(f.md)
  const mcp = s.rules?.mcp
  const mcpError = mcp?.error ?? ''
  const skills = s.rules?.skills?.[scope] ?? []
  const load = s.rules?.load
  const servers: McpRow[] = (mcp?.rows ?? []).filter(m => (scope === 'repo' ? m.scope !== 'user' : m.scope === 'user'))
  const moreOpen = !!s.ui.collapsed['rules-more']
  const nSkills = load ? load.skills.length : skills.length
  const state = load
    ? `${plural(load.files.length, 'CLAUDE.md file')} · ${plural(hooks.length, 'hook')} · ${plural(nSkills, 'skill')} load before you type, ≈${kTok(load.total)} tokens`
    : `${plural(hooks.length, 'hook')} · ${plural(perms.length, 'permission rule')} · ${plural(lines.length, 'instruction')}`
  return (
    <Box flexDirection="column" gap={v.desk ? 'md' : 1}>
      <Text color={t.text} bold wrap="wrap">{state}</Text>
      <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Seg v={v} id="rscope" value={scope} items={[['repo', 'This repository'], ['user', 'You, everywhere']]} onPick={k => setUi($, { ...clear, ruleScope: k as 'repo' | 'user' })} />
      </Box>
      {load && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" columnGap={sp(v, 1)} flexWrap="wrap">
            <Text color={t.dim} size="footnote" bold>LOADS EVERY SESSION</Text>
            <Text color={t.accent} size="footnote" bold>{`≈ ${load.total.toLocaleString('en-US')} tokens`}</Text>
          </Box>
          {load.files.map(fl => (
            <Box key={`ld-f-${fl.path}`} columnGap={sp(v, 1)} justifyContent="space-between">
              <Box flexShrink={1}>
                <Text color={fl.missing ? t.bad : t.text} size="footnote" wrap="truncate-start">{`${fl.via ? '↳ ' : ''}${fl.label ?? fl.path}`}</Text>
              </Box>
              <Text color={fl.missing ? t.bad : fl.long || fl.outside || fl.skipped ? t.busy : t.dim} size="footnote">
                {fl.missing ? 'missing' : fl.skipped ? `${fl.skipped}, not read` : `${fl.lines} lines · ≈${fl.tokens}${fl.long ? ' · over 200 lines (advised)' : ''}${fl.outside ? ' · outside, loads once approved' : ''}`}
              </Text>
            </Box>
          ))}
          {load.files.length === 0 && <Text color={t.faint} size="footnote">No CLAUDE.md here or in ~/.claude.</Text>}
        </Box>
      )}
      <More v={v} id="fold-more-rules" open={moreOpen} onPress={() => setUi($, ui => ({ collapsed: { ...ui.collapsed, 'rules-more': !moreOpen } }))} />
      {moreOpen && (
        <Box flexDirection="column" gap={v.desk ? 'md' : 1}>
          <Button key="rules-reload" plain onPress={() => loadRules($)}>
            <Text color={t.dim} size="footnote">↻ Read again</Text>
          </Button>
          {load && (
            <Box flexDirection="column">
          <Text color={t.dim} size="footnote" wrap="wrap">{`Skills Claude may load: ${load.skills.length} · ≈${load.skills.reduce((a, k) => a + k.tokens, 0)}`}</Text>
          {load.largest.map(k => (
            <Box key={`ld-k-${k.path}`} columnGap={sp(v, 1)} justifyContent="space-between" alignItems="center">
              <Box flexShrink={1}>
                <Text color={t.text} size="footnote" wrap="truncate-end">{`  ${k.name} · ≈${k.tokens}`}</Text>
              </Box>
              <Button key={`ld-${k.path}`} plain onPress={() => writeSkill($, k.path, false)}>
                <Text color={t.accent} size="footnote">Call only</Text>
              </Button>
            </Box>
          ))}
          <Text color={t.dim} size="footnote" wrap="wrap">{`MCP servers on: ${load.mcpOn} · their tools' cost: /context`}</Text>
          <Text color={t.faint} size="footnote" wrap="wrap">Estimates (characters ÷ 4), before Claude Code's own system prompt and tools.</Text>
            </Box>
          )}
      <Text color={t.faint} size="footnote" wrap="wrap">{scope === 'repo' ? 'Shared with everyone who works in this repository (commit them to share them).' : 'Yours, in every repository on this machine.'} Hooks run shell commands: read one before you add it.</Text>
      {error !== '' && <Text color={t.bad} wrap="wrap">{`${f.settingsPath} is ${error}. Hooks and permissions are shown read-only until it is fixed by hand.`}</Text>}

      <Box flexDirection="column">
        {head('Hooks', hooks.length, 'hook', settingsName)}
        {s.ui.ruleAdd === 'hook' && !error && (
          <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
            <Box columnGap={sp(v, 2)} flexWrap="wrap" alignItems="center">
              <Select key="rh-event" label="When" value={s.ui.ruleA || 'PreToolUse'} options={HOOK_EVENTS.map(x => ({ value: x, label: x }))} onSelect={val => setUi($, { ruleA: val })} />
              {field('ruleB', 'Matcher', 'Bash, Edit|Write, or empty for all', () => null)}
            </Box>
            {field('ruleC', 'Command', 'npx prettier --write "$CLAUDE_FILE_PATHS"', val => addHook(val))}
            <Button key="rh-go" label="Add hook" variant="primary" onPress={() => addHook()} />
          </Box>
        )}
        {hooks.length === 0 && s.ui.ruleAdd !== 'hook' && <Text color={t.faint} size="footnote">None yet.</Text>}
        {hooks.map(hk => {
          const key = `h:${hk.key}`
          const saveHook = (val = s.ui.ruleC ?? '') => save(writeSettings($, scope, j => changeHook(j, { edit: hk, matcher: (s.ui.ruleB ?? '').trim(), command: val.trim() || hk.command }), 'Hook saved'))
          if (s.ui.ruleEdit === key)
            return (
              <Box key={key} flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
                <Text color={t.dim} size="footnote">{hk.event}</Text>
                {field('ruleB', 'Matcher', 'empty for all', () => null)}
                {field('ruleC', 'Command', hk.command, val => saveHook(val))}
                <Box columnGap={sp(v, 1)}>
                  <Button key="rh-save" label="Save" variant="primary" onPress={() => saveHook()} />
                  <Button key="rh-cancel" label="Cancel" onPress={() => setUi($, clear)} />
                </Box>
              </Box>
            )
          return (
            <Box key={key} columnGap={sp(v, 1)} alignItems="center">
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text size="footnote" wrap="truncate-end">
                  <Text color={t.accent}>{hk.event}</Text>
                  <Text color={t.dim}>{hk.matcher ? `  ${hk.matcher}` : '  every tool'}</Text>
                </Text>
                <Text color={t.text} mono wrap="truncate-end">{hk.command}</Text>
              </Box>
              {!error && actions(key, () => setUi($, { ...clear, ruleEdit: key, ruleB: hk.matcher, ruleC: hk.command }), () => save(writeSettings($, scope, j => changeHook(j, { remove: hk }), 'Hook deleted')))}
            </Box>
          )
        })}
      </Box>

      <Box flexDirection="column">
        {head('Permission rules', perms.length, 'perm', settingsName)}
        {s.ui.ruleAdd === 'perm' && !error && (
          <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
            <Seg v={v} id="rp-kind" value={(s.ui.ruleA || 'allow') as PermKind} items={PERM_KINDS.map(k => [k, k] as [PermKind, string])} onPick={k => setUi($, { ruleA: k })} />
            {field('ruleB', 'Rule', 'Bash(npm test:*), Read(./docs/**), WebFetch(domain:example.com)', val => addPerm(val))}
            <Button key="rp-go" label="Add rule" variant="primary" onPress={() => addPerm()} />
          </Box>
        )}
        {perms.length === 0 && s.ui.ruleAdd !== 'perm' && <Text color={t.faint} size="footnote">None yet.</Text>}
        {perms.map(p => {
          const key = `p:${p.key}`
          const savePerm = (val = s.ui.ruleB ?? '') => save(writeSettings($, scope, j => changePerm(j, { edit: p, kind: (s.ui.ruleA || p.kind) as PermKind, rule: val.trim() || p.rule }), 'Rule saved'))
          if (s.ui.ruleEdit === key)
            return (
              <Box key={key} flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
                <Seg v={v} id="rp-ekind" value={(s.ui.ruleA || p.kind) as PermKind} items={PERM_KINDS.map(k => [k, k] as [PermKind, string])} onPick={k => setUi($, { ruleA: k })} />
                {field('ruleB', 'Rule', p.rule, val => savePerm(val))}
                <Box columnGap={sp(v, 1)}>
                  <Button key="rp-save" label="Save" variant="primary" onPress={() => savePerm()} />
                  <Button key="rp-cancel" label="Cancel" onPress={() => setUi($, clear)} />
                </Box>
              </Box>
            )
          return (
            <Box key={key} columnGap={sp(v, 1)} alignItems="center">
              <Box width="12%" flexShrink={0}>
                <Text color={p.kind === 'deny' ? t.bad : p.kind === 'ask' ? t.busy : t.ok} size="footnote">{p.kind}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={t.text} mono wrap="truncate-end">{p.rule}</Text>
              </Box>
              {!error && actions(key, () => setUi($, { ...clear, ruleEdit: key, ruleA: p.kind, ruleB: p.rule }), () => save(writeSettings($, scope, j => changePerm(j, { remove: p }), 'Rule deleted')))}
            </Box>
          )
        })}
      </Box>

      <Box flexDirection="column">
        {head('MCP servers', servers.length, scope === 'repo' && !mcpError ? 'mcp' : '', scope === 'repo' ? '.mcp.json' : '~/.claude.json')}
        {mcpError !== '' && scope === 'repo' && <Text color={t.bad} wrap="wrap">{`${mcp?.path} is ${mcpError}. Its servers are shown read-only until it is fixed by hand.`}</Text>}
        {s.ui.ruleAdd === 'mcp' && (
          <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
            {field('ruleA', 'Name', 'github', () => null)}
            {field('ruleB', 'Command or URL', 'npx -y @modelcontextprotocol/server-github, or https://…/mcp', val => addMcp(val))}
            <Text color={t.faint} size="footnote" wrap="wrap">A server's env and headers (tokens) are added in .mcp.json by hand; Cockpit never shows their values.</Text>
            <Button key="rm-go" label="Add server" variant="primary" onPress={() => ((s.ui.ruleA ?? '').trim() ? addMcp() : undefined)} />
          </Box>
        )}
        {servers.length === 0 && s.ui.ruleAdd !== 'mcp' && <Text color={t.faint} size="footnote">None yet.</Text>}
        {servers.map(m => {
          const key = `m:${m.key}`
          const editable = m.scope === 'project' && !mcpError
          const saveMcp = (val = s.ui.ruleB ?? '') => save(writeMcp($, { edit: m, name: (s.ui.ruleA ?? '').trim(), target: val.trim() }, 'Server saved'))
          if (s.ui.ruleEdit === key)
            return (
              <Box key={key} flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
                {field('ruleA', 'Name', m.name, () => null)}
                {m.masked && <Text color={t.faint} size="footnote" wrap="wrap">What it runs holds a token, so it is not shown here: leave it empty to keep it, or change it in .mcp.json by hand.</Text>}
                {!m.masked && field('ruleB', 'Command or URL', m.target, val => saveMcp(val))}
                <Box columnGap={sp(v, 1)}>
                  <Button key="rm-save" label="Save" variant="primary" onPress={() => saveMcp()} />
                  <Button key="rm-cancel" label="Cancel" onPress={() => setUi($, clear)} />
                </Box>
              </Box>
            )
          return (
            <Box key={key} columnGap={sp(v, 1)} alignItems="center">
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Box columnGap={sp(v, 2)} flexWrap="wrap">
                  <Text color={t.accent} size="footnote" wrap="truncate-end">{m.name}</Text>
                  <Text color={m.state === 'on' ? t.ok : m.state === 'approval' ? t.busy : t.dim} size="footnote">{MCP_STATE[m.state]}</Text>
                  <Text color={t.dim} size="footnote">{m.scope === 'local' ? `${m.kind} · local, only you` : m.kind}</Text>
                </Box>
                <Text color={t.text} mono wrap="truncate-end">{m.target}</Text>
                {m.secrets.length > 0 && <Text color={t.faint} size="footnote" wrap="truncate-end">{`secrets: ${m.secrets.join(', ')}`}</Text>}
              </Box>
              {/* A masked target is never put in a field: such a server is renamed or deleted here, and what it runs is
                  changed in .mcp.json by hand */}
              {editable && actions(key, () => setUi($, { ...clear, ruleEdit: key, ruleA: m.name, ruleB: m.masked ? '' : m.target }), () => save(writeMcp($, { remove: m }, 'Server deleted')))}
            </Box>
          )
        })}
      </Box>

      <Box flexDirection="column">
        {head('Skills', skills.length, '', scope === 'repo' ? '.claude/skills' : '~/.claude/skills')}
        {skills.length === 0 && <Text color={t.faint} size="footnote">None yet.</Text>}
        {skills.map(k => (
          <Box key={`k:${k.path}`} columnGap={sp(v, 1)} alignItems="center">
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Box columnGap={sp(v, 2)} flexWrap="wrap">
                <Text color={t.accent} size="footnote" wrap="truncate-end">{k.name || k.folder}</Text>
                {!k.error && <Text color={k.auto ? t.ok : t.dim} size="footnote">{k.auto ? 'Claude loads it' : `only when you call /${k.name || k.folder}`}</Text>}
              </Box>
              {k.error ? <Text color={t.bad} size="footnote" wrap="wrap">{`SKILL.md: ${k.error}. Shown read only.`}</Text> : <Text color={t.text} size="footnote" wrap="wrap">{k.description || '(no description)'}</Text>}
            </Box>
            {!k.error && (
              <Button key={`sk-${k.path}`} plain onPress={() => writeSkill($, k.path, !k.auto)}>
                <Text color={t.accent} size="footnote">{k.auto ? 'Call only' : 'Let Claude'}</Text>
              </Button>
            )}
          </Box>
        ))}
      </Box>

      <Box flexDirection="column">
        {head('Instructions', lines.length, 'rule', f.mdPath.replace(/^.*\//, ''))}
        {s.ui.ruleAdd === 'rule' && (
          <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
            {field('ruleB', 'Instruction', 'Run the tests before saying something works', val => addRule(val))}
            <Button key="rr-go" label="Add instruction" variant="primary" onPress={() => addRule()} />
          </Box>
        )}
        {lines.length === 0 && s.ui.ruleAdd !== 'rule' && <Text color={t.faint} size="footnote">{f.md ? 'No bullet lines: the file is prose, kept as it is.' : 'None yet.'}</Text>}
        {lines.map(r => {
          const key = `r:${r.key}`
          const saveRule = (val = s.ui.ruleB ?? '') => save(writeInstructions($, scope, md => changeRule(md, { edit: r, text: val.trim() || r.text }), 'Instruction saved'))
          if (s.ui.ruleEdit === key)
            return (
              <Box key={key} flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
                {field('ruleB', 'Instruction', r.text, val => saveRule(val))}
                <Box columnGap={sp(v, 1)}>
                  <Button key="rr-save" label="Save" variant="primary" onPress={() => saveRule()} />
                  <Button key="rr-cancel" label="Cancel" onPress={() => setUi($, clear)} />
                </Box>
              </Box>
            )
          return (
            <Box key={key} columnGap={sp(v, 1)} alignItems="center">
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="wrap">
                  <Text color={t.faint}>{'• '}</Text>
                  <Text color={t.text}>{r.text}</Text>
                </Text>
              </Box>
              {actions(key, () => setUi($, { ...clear, ruleEdit: key, ruleB: r.text }), () => save(writeInstructions($, scope, md => changeRule(md, { remove: r }), 'Instruction deleted')))}
            </Box>
          )
        })}
      </Box>
        </Box>
      )}
    </Box>
  )
}

const MCP_STATE = { on: 'on', off: 'off', approval: 'needs approval', shadowed: 'hidden by a nearer server of this name' } as const
