import type { ElementTable, EngineInterface, RenderNode } from 'claude-code'

import type { Account, Agent, Decision, GitForm, McpRow, Ph, Tab, ThemeId } from '../../types'
import {
  applyAccount,
  commit,
  confirmPending,
  createAgent,
  buildMemory,
  discoverAgentTypes,
  loadProject,
  runExpert,
  ghLoginToken,
  ghLoginWeb,
  planCommit,
  pushNow,
  pullNow,
  showCommit,
  skipPending,
  suggestCommit,
  gitInit,
  loadAccounts,
  removeAccount,
  useAccount,
  refreshRepo,
  set,
  startPipeline,
  setTheme,
  spawnAgent,
  stopAgent,
  rerun,
  compactNow,
  clearNow,
  runMany,
  stopAll,
  clearFinished,
  testAgent,
  TESTERS,
} from '../actions'
import {
  AGENT_TYPES,
  stepWords,
  planProgress,
  similarRuns,
  recallOf,
  neuralSvg,
  graphRows,
  graphSvg,
  graphText,
  agentIconSvg,
  AUTO_WHENS,
  BRANCH_PRESETS,
  COMMIT_MODES,
  EXPERTS,
  PIPELINES,
  FLOWS,
  progressOf,
  expertGlyph,
  expertName,
  verifyState,
  GIT_OPTS,
  MSG_PRESETS,
  TYPES,
  branchName,
  commitMsg,
  fmt,
  kTok,
  progress,
  ringRuns,
  ringSvg,
  tally,
  thrOf,
  tree,
} from '../logic'
import type { IconState, Neuron } from '../logic'
import { featureLayers, featureMapSvg, features as featureList, impactOf, isTestFeature, memberOf, memoryKey } from '../memory'
import type { FeatureMark } from '../memory'
import { loadRules, pickFlow, resumeAutopilot, setGit as setGitPref, startAutopilot, stopAutopilot, writeInstructions, writeMcp, writeSettings } from '../actions'
import { HOOK_EVENTS, PERM_KINDS, changeHook, changePerm, changeRule, hookRows, parseSettings, permRows, ruleLines } from '../rules'
import type { PermKind } from '../rules'
import { THEMES, THEME_IDS, ctxShades } from '../theme'
import type { Theme } from '../theme'
import type { $, UI, V } from './shared'
import { sp, grow, Bar, Tracker, Segs, pad, cut, Seg, Check, Rule, kindColor, Head, MapText, Card, seatDots } from './shared'

// Rules: the hooks, permission rules and instructions Claude Code follows, for this repository or for you everywhere.
// Each is a row to edit in place or delete (after you confirm); each section has an add form. Every change is written
// back to its file with the rest of the file kept; a settings file that is not valid JSON is shown, never written
export function Rules($: $, v: V) {
  const { Box, Button, Input, Select, Text } = v.ui
  const { s, t } = v
  const scope = s.ui.ruleScope ?? 'repo'
  const f = s.rules?.[scope]
  const ui = (patch: Partial<Ph['ui']>) => set($, st => ({ ui: { ...st.ui, ...patch } }))
  const clear = { ruleEdit: '', ruleDel: '', ruleAdd: '', ruleA: '', ruleB: '', ruleC: '' }
  // Enter submits with the text as typed: the drawing it was typed into may not have it yet
  const field = (key: 'ruleA' | 'ruleB' | 'ruleC', label: string, placeholder: string, onSubmit: (val: string) => unknown) => (
    <Input key={`rf-${key}`} label={label} placeholder={placeholder} value={s.ui[key] ?? ''} rows={grow(v, s.ui[key], label)} submitLabel={s.ui.ruleEdit ? 'save' : 'add'} onInput={val => ui({ [key]: val })} onSubmit={val => onSubmit(val)} />
  )
  const actions = (key: string, onEdit: () => unknown) =>
    s.ui.ruleDel === key ? (
      <Box columnGap={sp(v, 1)}>
        <Text color={t.bad} size="footnote">Delete?</Text>
        <Button key={`rdy-${key}`} plain onPress={() => (rowsDelete.get(key) ?? (() => null))()}>
          <Text color={t.bad} size="footnote">Delete</Text>
        </Button>
        <Button key={`rdn-${key}`} plain onPress={() => ui({ ruleDel: '' })}>
          <Text color={t.dim} size="footnote">Keep</Text>
        </Button>
      </Box>
    ) : (
      <Box columnGap={sp(v, 1)}>
        <Button key={`re-${key}`} plain onPress={() => onEdit()}>
          <Text color={t.faint}>✎</Text>
        </Button>
        <Button key={`rd-${key}`} plain onPress={() => ui({ ruleDel: key })}>
          <Text color={t.faint}>✕</Text>
        </Button>
      </Box>
    )
  const rowsDelete = new Map<string, () => unknown>()
  const save = (p: Promise<unknown>) => p.then(() => ui(clear))
  const head = (label: string, n: number, add: string, path: string) => (
    <Box justifyContent="space-between" alignItems="center" columnGap={sp(v, 1)}>
      <Text size="footnote" bold wrap="truncate-end">
        <Text color={t.dim}>{label.toUpperCase()}</Text>
        <Text color={t.faint}>{` ${n}`}</Text>
        <Text color={t.faint} bold={false}>{`  ${path}`}</Text>
      </Text>
      {add !== '' && <Button key={`radd-${add}`} plain onPress={() => ui({ ...clear, ruleAdd: s.ui.ruleAdd === add ? '' : add, ruleA: add === 'hook' ? 'PreToolUse' : add === 'perm' ? 'allow' : '' })}>
        <Text color={t.accent} size="footnote">{s.ui.ruleAdd === add ? '✕ Close' : '+ Add'}</Text>
      </Button>}
    </Box>
  )
  if (!f) return <Text color={t.dim}>Reading the rules…</Text>
  const { json, error } = parseSettings(f.settings)
  const hooks = hookRows(json)
  const perms = permRows(json)
  const lines = ruleLines(f.md)
  const mcp = s.rules?.mcp
  const mcpError = mcp?.error ?? ''
  const servers: McpRow[] = (mcp?.rows ?? []).filter(m => (scope === 'repo' ? m.scope !== 'user' : m.scope === 'user'))
  return (
    <Box flexDirection="column" gap={v.desk ? 'md' : 1}>
      <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Seg v={v} id="rscope" value={scope} items={[['repo', 'This repository'], ['user', 'You, everywhere']]} onPick={k => ui({ ...clear, ruleScope: k as 'repo' | 'user' })} />
        <Button key="rules-reload" plain onPress={() => loadRules($)}>
          <Text color={t.dim} size="footnote">↻ Read again</Text>
        </Button>
      </Box>
      <Text color={t.faint} size="footnote" wrap="wrap">{scope === 'repo' ? 'Shared with everyone who works in this repository (commit them to share them).' : 'Yours, in every repository on this machine.'} Hooks run shell commands: read one before you add it.</Text>
      {error !== '' && <Text color={t.bad} wrap="wrap">{`${f.settingsPath} is ${error}. Hooks and permissions are shown read-only until it is fixed by hand.`}</Text>}

      <Box flexDirection="column">
        {head('Hooks', hooks.length, 'hook', f.settingsPath.replace(/^.*\/(\.claude\/)/, '$1'))}
        {s.ui.ruleAdd === 'hook' && !error && (
          <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
            <Box columnGap={sp(v, 2)} flexWrap="wrap" alignItems="center">
              <Select key="rh-event" label="When" value={s.ui.ruleA || 'PreToolUse'} options={HOOK_EVENTS.map(x => ({ value: x, label: x }))} onSelect={val => ui({ ruleA: val })} />
              {field('ruleB', 'Matcher', 'Bash, Edit|Write, or empty for all', (val: string) => null)}
            </Box>
            {field('ruleC', 'Command', 'npx prettier --write "$CLAUDE_FILE_PATHS"', (val: string) => val.trim() && save(writeSettings($, scope, j => changeHook(j, { add: { event: s.ui.ruleA || 'PreToolUse', matcher: (s.ui.ruleB ?? '').trim(), command: val.trim() } }), 'Hook added')))}
            <Button key="rh-go" label="Add hook" variant="primary" onPress={() => ((s.ui.ruleC ?? '').trim() ? save(writeSettings($, scope, j => changeHook(j, { add: { event: s.ui.ruleA || 'PreToolUse', matcher: (s.ui.ruleB ?? '').trim(), command: (s.ui.ruleC ?? '').trim() } }), 'Hook added')) : undefined)} />
          </Box>
        )}
        {hooks.length === 0 && s.ui.ruleAdd !== 'hook' && <Text color={t.faint} size="footnote">None yet.</Text>}
        {hooks.map(hk => {
          const key = `h:${hk.key}`
          rowsDelete.set(key, () => save(writeSettings($, scope, j => changeHook(j, { remove: hk }), 'Hook deleted')))
          if (s.ui.ruleEdit === key)
            return (
              <Box key={key} flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
                <Text color={t.dim} size="footnote">{hk.event}</Text>
                {field('ruleB', 'Matcher', 'empty for all', (val: string) => null)}
                {field('ruleC', 'Command', hk.command, (val: string) => save(writeSettings($, scope, j => changeHook(j, { edit: hk, matcher: (s.ui.ruleB ?? '').trim(), command: val.trim() || hk.command }), 'Hook saved')))}
                <Box columnGap={sp(v, 1)}>
                  <Button key="rh-save" label="Save" variant="primary" onPress={() => save(writeSettings($, scope, j => changeHook(j, { edit: hk, matcher: (s.ui.ruleB ?? '').trim(), command: (s.ui.ruleC ?? '').trim() || hk.command }), 'Hook saved'))} />
                  <Button key="rh-cancel" label="Cancel" onPress={() => ui(clear)} />
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
              {!error && actions(key, () => ui({ ...clear, ruleEdit: key, ruleB: hk.matcher, ruleC: hk.command }))}
            </Box>
          )
        })}
      </Box>

      <Box flexDirection="column">
        {head('Permission rules', perms.length, 'perm', f.settingsPath.replace(/^.*\/(\.claude\/)/, '$1'))}
        {s.ui.ruleAdd === 'perm' && !error && (
          <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
            <Seg v={v} id="rp-kind" value={(s.ui.ruleA || 'allow') as PermKind} items={PERM_KINDS.map(k => [k, k] as [PermKind, string])} onPick={k => ui({ ruleA: k })} />
            {field('ruleB', 'Rule', 'Bash(npm test:*), Read(./docs/**), WebFetch(domain:example.com)', (val: string) => val.trim() && save(writeSettings($, scope, j => changePerm(j, { add: { kind: (s.ui.ruleA || 'allow') as PermKind, rule: val.trim() } }), 'Rule added')))}
            <Button key="rp-go" label="Add rule" variant="primary" onPress={() => ((s.ui.ruleB ?? '').trim() ? save(writeSettings($, scope, j => changePerm(j, { add: { kind: (s.ui.ruleA || 'allow') as PermKind, rule: (s.ui.ruleB ?? '').trim() } }), 'Rule added')) : undefined)} />
          </Box>
        )}
        {perms.length === 0 && s.ui.ruleAdd !== 'perm' && <Text color={t.faint} size="footnote">None yet.</Text>}
        {perms.map(p => {
          const key = `p:${p.key}`
          rowsDelete.set(key, () => save(writeSettings($, scope, j => changePerm(j, { remove: p }), 'Rule deleted')))
          if (s.ui.ruleEdit === key)
            return (
              <Box key={key} flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
                <Seg v={v} id="rp-ekind" value={(s.ui.ruleA || p.kind) as PermKind} items={PERM_KINDS.map(k => [k, k] as [PermKind, string])} onPick={k => ui({ ruleA: k })} />
                {field('ruleB', 'Rule', p.rule, (val: string) => save(writeSettings($, scope, j => changePerm(j, { edit: p, kind: (s.ui.ruleA || p.kind) as PermKind, rule: val.trim() || p.rule }), 'Rule saved')))}
                <Box columnGap={sp(v, 1)}>
                  <Button key="rp-save" label="Save" variant="primary" onPress={() => save(writeSettings($, scope, j => changePerm(j, { edit: p, kind: (s.ui.ruleA || p.kind) as PermKind, rule: (s.ui.ruleB ?? '').trim() || p.rule }), 'Rule saved'))} />
                  <Button key="rp-cancel" label="Cancel" onPress={() => ui(clear)} />
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
              {!error && actions(key, () => ui({ ...clear, ruleEdit: key, ruleA: p.kind, ruleB: p.rule }))}
            </Box>
          )
        })}
      </Box>

      <Box flexDirection="column">
        {head('MCP servers', servers.length, scope === 'repo' && !mcpError ? 'mcp' : '', scope === 'repo' ? '.mcp.json' : '~/.claude.json')}
        {mcpError !== '' && scope === 'repo' && <Text color={t.bad} wrap="wrap">{`${mcp?.path} is ${mcpError}. Its servers are shown read-only until it is fixed by hand.`}</Text>}
        {s.ui.ruleAdd === 'mcp' && (
          <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
            {field('ruleA', 'Name', 'github', (val: string) => null)}
            {field('ruleB', 'Command or URL', 'npx -y @modelcontextprotocol/server-github, or https://…/mcp', (val: string) => val.trim() && save(writeMcp($, { add: { name: (s.ui.ruleA ?? '').trim(), target: val.trim() } }, 'Server added')))}
            <Text color={t.faint} size="footnote" wrap="wrap">A server's env and headers (tokens) are added in .mcp.json by hand; Cockpit never shows their values.</Text>
            <Button key="rm-go" label="Add server" variant="primary" onPress={() => ((s.ui.ruleA ?? '').trim() && (s.ui.ruleB ?? '').trim() ? save(writeMcp($, { add: { name: (s.ui.ruleA ?? '').trim(), target: (s.ui.ruleB ?? '').trim() } }, 'Server added')) : undefined)} />
          </Box>
        )}
        {servers.length === 0 && s.ui.ruleAdd !== 'mcp' && <Text color={t.faint} size="footnote">None yet.</Text>}
        {servers.map(m => {
          const key = `m:${m.key}`
          const editable = m.scope === 'project' && !mcpError
          if (editable) rowsDelete.set(key, () => save(writeMcp($, { remove: m }, 'Server deleted')))
          if (s.ui.ruleEdit === key)
            return (
              <Box key={key} flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
                {field('ruleA', 'Name', m.name, (val: string) => null)}
                {m.masked && <Text color={t.faint} size="footnote" wrap="wrap">What it runs holds a token, so it is not shown here: leave it empty to keep it, or change it in .mcp.json by hand.</Text>}
                {!m.masked && field('ruleB', 'Command or URL', m.target, (val: string) => save(writeMcp($, { edit: m, name: (s.ui.ruleA ?? '').trim(), target: val.trim() }, 'Server saved')))}
                <Box columnGap={sp(v, 1)}>
                  <Button key="rm-save" label="Save" variant="primary" onPress={() => save(writeMcp($, { edit: m, name: (s.ui.ruleA ?? '').trim(), target: (s.ui.ruleB ?? '').trim() }, 'Server saved'))} />
                  <Button key="rm-cancel" label="Cancel" onPress={() => ui(clear)} />
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
              {editable && actions(key, () => ui({ ...clear, ruleEdit: key, ruleA: m.name, ruleB: m.masked ? '' : m.target }))}
            </Box>
          )
        })}
      </Box>

      <Box flexDirection="column">
        {head('Instructions', lines.length, 'rule', f.mdPath.replace(/^.*\//, ''))}
        {s.ui.ruleAdd === 'rule' && (
          <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
            {field('ruleB', 'Instruction', 'Run the tests before saying something works', (val: string) => val.trim() && save(writeInstructions($, scope, md => changeRule(md, { add: val.trim() }), 'Instruction added')))}
            <Button key="rr-go" label="Add instruction" variant="primary" onPress={() => ((s.ui.ruleB ?? '').trim() ? save(writeInstructions($, scope, md => changeRule(md, { add: (s.ui.ruleB ?? '').trim() }), 'Instruction added')) : undefined)} />
          </Box>
        )}
        {lines.length === 0 && s.ui.ruleAdd !== 'rule' && <Text color={t.faint} size="footnote">{f.md ? 'No bullet lines: the file is prose, kept as it is.' : 'None yet.'}</Text>}
        {lines.map(r => {
          const key = `r:${r.key}`
          rowsDelete.set(key, () => save(writeInstructions($, scope, md => changeRule(md, { remove: r }), 'Instruction deleted')))
          if (s.ui.ruleEdit === key)
            return (
              <Box key={key} flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
                {field('ruleB', 'Instruction', r.text, (val: string) => save(writeInstructions($, scope, md => changeRule(md, { edit: r, text: val.trim() || r.text }), 'Instruction saved')))}
                <Box columnGap={sp(v, 1)}>
                  <Button key="rr-save" label="Save" variant="primary" onPress={() => save(writeInstructions($, scope, md => changeRule(md, { edit: r, text: (s.ui.ruleB ?? '').trim() || r.text }), 'Instruction saved'))} />
                  <Button key="rr-cancel" label="Cancel" onPress={() => ui(clear)} />
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
              {actions(key, () => ui({ ...clear, ruleEdit: key, ruleB: r.text }))}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

const MCP_STATE = { on: 'on', off: 'off', approval: 'needs approval', shadowed: 'hidden by a nearer server of this name' } as const
