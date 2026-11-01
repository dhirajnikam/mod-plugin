import type { ElementTable, EngineInterface, RenderNode } from 'claude-code'

import type { Account, Agent, Decision, GitForm, Ph, Tab, ThemeId } from '../../types'
import {
  inBackground,
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
import { loadRules, pickFlow, resumeAutopilot, setGit as setGitPref, startAutopilot, stopAutopilot, writeInstructions, writeSettings } from '../actions'
import { HOOK_EVENTS, PERM_KINDS, changeHook, changePerm, changeRule, hookRows, parseSettings, permRows, ruleLines } from '../rules'
import type { PermKind } from '../rules'
import { THEMES, THEME_IDS, ctxShades } from '../theme'
import type { Theme } from '../theme'
import type { $, UI, V } from './shared'
import { sp, Bar, Tracker, Segs, pad, cut, Seg, Check, Rule, kindColor, Head, MapText, Card, seatDots } from './shared'

export function Git($: $, v: V) {
  const { Box, Button, Input, Select, Text } = v.ui
  const { s, t } = v
  const g = s.git
  const setGit = (patch: Partial<GitForm>) => setGitPref($, patch)
  if (!s.repo.isRepo) {
    return (
      <Box flexDirection="column" gap={sp(v, 1)}>
        <Text color={t.dim}>This folder is not a git repository.</Text>
        <Box gap={sp(v, 1)}>
          <Button key="git-init" label="git init" variant="primary" onPress={() => gitInit($)} />
          <Button key="git-refresh" label="Refresh" onPress={() => refreshRepo($)} />
        </Box>
      </Box>
    )
  }
  if (!g.setupDone) return Setup($, v)
  const plan = planCommit(s)
  const staged = plan.files.length
  const allOn = staged === s.repo.changed.length
  const acct = s.accounts.find(a => a.id === s.accountId)
  const mode = COMMIT_MODES.find(m => m[0] === g.commitMode)?.[1] ?? 'Ask me'
  const when = g.commitMode === 'manual' ? '' : ` · ${AUTO_WHENS.find(a => a.v === g.autoWhen)?.label ?? AUTO_WHENS[0]?.label}`
  const newBranch = plan.branch !== s.repo.current
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Text>
          <Text color={t.accent} bold>{`⎇ ${s.repo.current || '(no branch)'}`}</Text>
          {s.repo.ahead > 0 && <Text color={t.busy}>{`  ↑${s.repo.ahead} to push`}</Text>}
          {s.repo.behind > 0 && <Text color={t.hi}>{`  ↓${s.repo.behind} to pull`}</Text>}
          {s.repo.changed.length > 0 && <Text color={t.dim}>{`  ·  ${s.repo.changed.length} changed`}</Text>}
        </Text>
        <Box gap={sp(v, 1)} flexWrap="wrap">
          {s.repo.behind > 0 && <Button key="git-pull" label="↓ Pull" plain onPress={() => inBackground($, 'pull', 'Pulling', () => pullNow($))} />}
          {s.repo.ahead > 0 && <Button key="git-push" label="↑ Push" plain onPress={() => inBackground($, 'push', 'Pushing', () => pushNow($))} />}
          <Button key="git-refresh" label="↻" plain onPress={() => refreshRepo($)} />
          <Button key="git-setup" label="⚙" plain onPress={() => Promise.all([setGit({ setupDone: false }), set($, st => ({ ui: { ...st.ui, gitStep: 0 } }))])} />
        </Box>
      </Box>
      <Text color={t.dim} size="footnote" wrap="truncate-end">{`${acct ? `${acct.label} <${acct.email}>` : 'no account'}  ·  ${mode}${when}`}</Text>
      {s.pending && (
        <Box flexDirection="column" borderStyle="round" borderColor={t.busy} paddingX={1}>
          <Text color={t.busy} bold>Commit this?</Text>
          <Text color={t.hi} mono wrap="truncate-end">{s.pending.msg}</Text>
          <Text color={t.dim} size="footnote">{`→ ${s.pending.branch} · ${s.pending.files.length} files`}</Text>
          <Box gap={sp(v, 1)}>
            <Button key="pend-commit" label="Commit" variant="primary" onPress={() => inBackground($, 'commit', 'Committing', () => confirmPending($))} />
            <Button key="pend-skip" label="Skip" onPress={() => skipPending($)} />
          </Box>
        </Box>
      )}
      {s.repo.changed.length === 0 && (
        <Text>
          <Text color={t.ok}>{'✓ '}</Text>
          <Text color={t.text}>Working tree clean</Text>
          <Text color={t.dim}>{s.repo.ahead ? `  ·  ${s.repo.ahead} to push` : s.repo.unpushed.length || s.repo.log.length ? '  ·  nothing to commit or push' : '  ·  nothing to commit'}</Text>
        </Text>
      )}
      {s.repo.changed.length > 0 && (
      <Box flexDirection="column" borderStyle="round" borderColor={t.lo} paddingX={1}>
        <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
          <Text color={t.text} weight="semibold">Next commit</Text>
          <Text>
            <Text color={t.deep} backgroundColor={t.wash || undefined} bold>{` ${plan.type} `}</Text>
            <Text color={t.dim} size="footnote">{g.commitMode === 'manual' ? '  your pick' : s.suggest?.busy ? '  writing from the diff…' : '  from the changes'}</Text>
          </Text>
        </Box>
        {g.commitMode === 'manual' && <Seg v={v} id="ctype" value={g.type} items={TYPES.map(x => [x, x] as [string, string])} onPick={k => setGit({ type: k })} />}
        <Text color={plan.msg ? t.hi : t.dim} mono wrap="truncate-end">{plan.msg || 'Send a prompt, or change a file'}</Text>
        <Text size="footnote" wrap="truncate-end">
          <Text color={newBranch ? t.ok : t.dim}>{newBranch ? `⎇ new ${plan.branch}` : `⎇ ${plan.branch}`}</Text>
          <Text color={t.dim}>{`  ·  ${staged} of ${s.repo.changed.length} files${g.push ? '  ·  push' : ''}${g.pr ? `  ·  ${g.draft ? 'draft PR' : 'PR'} → ${g.base}` : ''}`}</Text>
        </Text>
        <Box justifyContent="flex-end">
          {staged > 0 ? <Button key="git-commit" label={g.push ? 'Commit & push' : 'Commit'} variant="primary" onPress={() => inBackground($, 'commit', g.push ? 'Committing and pushing' : 'Committing', () => commit($, false))} /> : <Text color={t.dim} size="footnote">Tick a file to commit it</Text>}
        </Box>
      </Box>
      )}
      {s.repo.changed.length > 0 && (
      <Box flexDirection="column">
        <Box justifyContent="space-between" flexWrap="wrap">
          <Text color={t.text} weight="semibold">{`Changes${s.repo.changed.length ? ` (${s.repo.changed.length})` : ''}`}</Text>
          {s.repo.changed.length > 1 && (
            <Button key="stage-all" plain onPress={() => set($, { staged: allOn ? Object.fromEntries(s.repo.changed.map(c => [c.path, false])) : {} }).then(() => suggestCommit($))}>
              <Text color={t.dim}>{allOn ? 'Untick all' : 'Tick all'}</Text>
            </Button>
          )}
        </Box>
        {s.repo.changed.map(c => (
          <Box key={`ch-${c.path}`} columnGap={sp(v, 1)}>
            <Text color={s.staged[c.path] !== false ? t.accent : t.faint}>{s.staged[c.path] !== false ? '▣' : '□'}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Button key={`stage-${c.path}`} plain onPress={() => set($, st => ({ staged: { ...st.staged, [c.path]: st.staged[c.path] === false } })).then(() => suggestCommit($))}>
                <Text color={s.staged[c.path] !== false ? t.text : t.dim} wrap="truncate-end">{c.path}</Text>
              </Button>
            </Box>
            <Text color={kindColor(t, c.meta)} size="footnote">{c.meta}</Text>
          </Box>
        ))}
      </Box>
      )}
      {s.repo.log.length > 0 && History($, v)}
      <Box justifyContent="space-between">
        <Button key="git-more" plain onPress={() => set($, st => ({ ui: { ...st.ui, more: !st.ui.more } }))}>
          <Text color={t.dim}>Account, patterns & options</Text>
        </Button>
        <Text color={t.dim}>{s.ui.more ? '⌄' : '›'}</Text>
      </Box>
      {s.ui.more && Options($, v)}
    </Box>
  )
}

// History: every branch, remote and tag as a graph, newest first. Each commit is a dot on its lane, lines carry the
// lanes down, a merge opens a lane and a branch joins one; refs ride on the commit as chips (HEAD's branch filled,
// local branches tinted, remotes and tags plain), unpushed commits are hollow, and a press opens the commit
function History($: $, v: V) {
  const { Box, Button, Svg, Text } = v.ui
  const { s, t } = v
  const log = s.repo.log
  const rows = graphRows(log)
  const width = Math.min(8, Math.max(1, ...rows.map(r => r.width)))
  const wide = v.w >= 60
  const pushed = s.repo.unpushed.length ? `${s.repo.unpushed.length} not pushed` : s.repo.ahead ? `${s.repo.ahead} not pushed` : 'all pushed'
  const chip = (ref: string, key: string) => {
    const head = ref.startsWith('HEAD')
    const name = ref.replace(/^HEAD -> /, '').replace(/^tag: /, '')
    const kind = head ? 'head' : ref.startsWith('tag: ') ? 'tag' : s.repo.branches.includes(name) ? 'branch' : 'remote'
    const [fg, bg, mark] =
      kind === 'head' ? [t.bg || 'inverseText', t.accent, '⎇ '] : kind === 'branch' ? [t.hi, t.wash || undefined, '⎇ '] : kind === 'tag' ? [t.ok, t.surface || undefined, '⌑ '] : [t.dim, t.surface || undefined, '☁ ']
    return (
      <Text key={key} color={fg} backgroundColor={bg} bold={kind === 'head'}>{` ${mark}${name} `}</Text>
    )
  }
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={sp(v, 1)}>
        <Text color={t.text} weight="semibold">History</Text>
        <Text color={t.dim} size="footnote">{`${log.length} commits · ${s.repo.branches.length} branches · ${pushed}`}</Text>
      </Box>
      {log.map((c, i) => {
        const r = rows[i]
        if (!r) return null
        const isHead = c.refs.some(x => x.startsWith('HEAD'))
        const unpushed = s.repo.unpushed.includes(c.sha)
        const node = isHead ? 'head' : unpushed ? 'unpushed' : c.parents.length > 1 ? 'merge' : 'plain'
        const own = s.commits.find(x => x.sha === c.sha)
        const open = s.ui.openCommit === c.sha
        const lane = (
          <Box flexShrink={0}>
            {Svg ? (
              <Svg source={graphSvg(r, width, node)} alt={`${c.sha} ${c.msg}`} width={9 + (width - 1) * 14 + 9} height={30} />
            ) : (
              <Text mono>
                {graphText(r, width, isHead ? '◉' : unpushed ? '○' : c.parents.length > 1 ? '◆' : '●').map((run, k) => (
                  <Text key={`gr-${c.sha}-${k}`} color={run.fg}>{run.t}</Text>
                ))}
              </Text>
            )}
          </Box>
        )
        return (
          <Box key={`lg-${c.sha}`} flexDirection="column">
            <Box alignItems="center" columnGap={sp(v, 1)}>
              {lane}
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`cm-${c.sha}`} plain onPress={() => showCommit($, c.sha)}>
                  <Text wrap="truncate-end">
                    {c.refs.map((ref, k) => chip(ref, `ref-${c.sha}-${k}`))}
                    {c.refs.length > 0 && <Text> </Text>}
                    <Text color={unpushed ? t.busy : t.text} bold={isHead}>{c.msg}</Text>
                    {own && <Text color={t.accent}>{own.auto ? '  ✦ auto' : '  ✦'}</Text>}
                  </Text>
                </Button>
              </Box>
              <Text color={t.faint} size="footnote" mono>{c.sha}</Text>
              {wide && <Text color={t.faint} size="footnote">{c.when}</Text>}
            </Box>
            {open && (
              <Box flexDirection="column" borderStyle="round" borderColor={t.divider} paddingX={1} marginLeft={2}>
                <Text color={t.dim} size="footnote">{`${c.author} · ${c.when}${unpushed ? ' · not pushed' : ''}${own ? ` · ${own.auto ? 'auto-committed' : 'committed'} by Cockpit` : ''}`}</Text>
                {(s.ui.commitInfo || 'Reading the commit…').split('\n').slice(0, 40).map((l, k) => (
                  <Text key={`ci-${c.sha}-${k}`} color={/\|\s+\d+\s*[+-]*$/.test(l) || / changed, /.test(l) ? t.dim : t.text} size="footnote" mono={/\|/.test(l) || / changed, /.test(l)} wrap="truncate-end">{l || ' '}</Text>
                ))}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// The account box: the accounts found, a token, or a login in the browser
function AccountBox($: $, v: V) {
  const { Box, Button, Input, Text } = v.ui
  const { s, t } = v
  const acct = s.accounts.find(a => a.id === s.accountId)
  // A saved login shows as it is; Modify opens the choices and the ways to add one
  const modify = s.ui.acctOpen || !acct
  const toggle = () => set($, st => ({ ui: { ...st.ui, acctOpen: !st.ui.acctOpen } }))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.divider} paddingX={1}>
      <Box justifyContent="space-between" flexWrap="wrap">
        <Text color={t.text} weight="semibold">Account</Text>
        <Box gap={sp(v, 1)}>
          {modify && <Button key="acct-detect" label="↻ Detect" plain onPress={() => loadAccounts($)} />}
          {acct && <Button key="acct-modify" label={s.ui.acctOpen ? 'Done' : 'Modify'} plain onPress={toggle} />}
        </Box>
      </Box>
      {acct && (
        <Text wrap="truncate-end">
          <Text color={t.ok}>{'● '}</Text>
          <Text color={t.text}>{acct.label}</Text>
          <Text color={t.dim}>{`  ${acct.name} <${acct.email}>${acct.gh ? ` · gh ${acct.gh}` : ''}`}</Text>
        </Text>
      )}
      {!acct && s.accounts.length === 0 && <Text color={t.dim}>No git identity or gh login found yet.</Text>}
      {modify && s.accounts.length > 0 && <Seg v={v} id="acct" value={s.accountId} items={s.accounts.map(a => [a.id, a.label] as [string, string])} onPick={k => useAccount($, k)} />}
      {modify && acct && s.ui.acctRemove !== acct.id && (
        <Box gap={sp(v, 1)} flexWrap="wrap">
          <Button key="acct-apply" label="Use for this repo" plain onPress={() => applyAccount($)} />
          <Button key="acct-remove" label="Remove" plain onPress={() => set($, st => ({ ui: { ...st.ui, acctRemove: acct.id } }))} />
        </Box>
      )}
      {modify && acct && s.ui.acctRemove === acct.id && (
        <Box flexDirection="column">
          <Text color={t.busy} wrap="wrap">
            {`Remove ${acct.label} from this machine? ${[acct.gh && `gh logs out ${acct.gh}`, acct.id === 'global' && `git's global user.name and user.email (${acct.name} <${acct.email}>) are unset`].filter(Boolean).join(', and ') || 'It leaves the saved accounts'}.`}
          </Text>
          <Box gap={sp(v, 1)}>
            <Button key="acct-remove-yes" label="Remove" variant="primary" onPress={() => removeAccount($, acct.id)} />
            <Button key="acct-remove-no" label="Cancel" onPress={() => set($, st => ({ ui: { ...st.ui, acctRemove: '' } }))} />
          </Box>
        </Box>
      )}
      {modify && (
        <Box flexDirection="column">
          <Rule v={{ ...v, w: v.w - 4 }} />
          <Text color={t.dim} size="footnote">Add a GitHub login to this machine's gh: paste a classic token (scopes repo, read:org), or log in with gh in your browser.</Text>
          <Box columnGap={sp(v, 1)} flexWrap="wrap">
            <Input key="gh-token" label="Token" placeholder="ghp_…" value={s.ui.ghToken} onInput={val => set($, st => ({ ui: { ...st.ui, ghToken: val } }))} onSubmit={val => inBackground($, 'gh-login', 'Logging in to GitHub', () => ghLoginToken($, val))} />
            <Button key="gh-token-go" label="Add token" onPress={() => inBackground($, 'gh-login', 'Logging in to GitHub', () => ghLoginToken($, s.ui.ghToken))} />
            <Button key="gh-web" label="Log in with gh" onPress={() => ghLoginWeb($)} />
          </Box>
        </Box>
      )}
      {s.ui.ghNote !== '' && <Text color={t.busy} wrap="wrap">{s.ui.ghNote}</Text>}
    </Box>
  )
}

// Setup for this repository, once: account, branch pattern, message pattern, commit mode, when
function Setup($: $, v: V) {
  const { Box, Button, Input, Text } = v.ui
  const { s, t } = v
  const g = s.git
  const setGit = (patch: Partial<GitForm>) => setGitPref($, patch)
  const step = s.ui.gitStep
  const go = (n: number) => set($, st => ({ ui: { ...st.ui, gitStep: n } }))
  const titles = ['Account', 'Branch pattern', 'Message pattern', 'Commit mode', 'When']
  const last = g.commitMode === 'manual' ? 3 : 4
  const nav = (
    <Box justifyContent="space-between" flexWrap="wrap">
      {step > 0 ? <Button key="setup-back" label="‹ Back" onPress={() => go(step - 1)} /> : <Text />}
      {step < last ? (
        <Button key="setup-next" label="Next ›" variant="primary" onPress={() => go(step + 1)} />
      ) : (
        <Button key="setup-done" label="Done" variant="primary" onPress={() => Promise.all([setGit({ setupDone: true }), go(0)])} />
      )}
    </Box>
  )
  const sample = { ...g, subject: 'add login page', type: 'feat', ticket: g.ticket || 'API-12' }
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      <Box flexWrap="wrap" columnGap={sp(v, 1)}>
        {titles.slice(0, last + 1).map((name, i) => (
          <Text key={`st-${i}`} color={i === step ? t.accent : i < step ? t.ok : t.dim} bold={i === step}>{`${i < step ? '✓' : '○'} ${name}`}</Text>
        ))}
      </Box>
      {step === 0 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">Which identity commits in this repository?</Text>
          {AccountBox($, v)}
        </Box>
      )}
      {step === 1 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">How are branches named? Cockpit cuts one off the base branch for each piece of work, kind chosen from the task (feature, fix, docs, …).</Text>
          <Seg v={v} id="bp" value={g.branchPattern} items={BRANCH_PRESETS.map(p => [p.v, p.label] as [string, string])} onPick={k => setGit({ branchPattern: k, branchAuto: true })} />
          <Input key="git-bpat" label="Pattern" value={g.branchPattern} onInput={val => setGit({ branchPattern: val, branchAuto: true })} onSubmit={val => setGit({ branchPattern: val, branchAuto: true })} />
          <Text color={t.dim} size="footnote">{`{kind} {type} {ticket} {slug} {user} · e.g. ${branchName({ ...sample, branchAuto: true }, g.base || 'main')}`}</Text>
          <Box columnGap={sp(v, 2)} flexWrap="wrap">
            <Input key="git-ticket" label="Ticket" placeholder="API-12" value={g.ticket} onInput={val => setGit({ ticket: val })} onSubmit={val => setGit({ ticket: val })} />
            <Input key="git-user" label="User" value={g.user} onInput={val => setGit({ user: val })} onSubmit={val => setGit({ user: val })} />
          </Box>
          <Check v={v} id="opt-branchAuto" on={g.branchAuto} label="Cut a new branch when on the base branch" onPress={() => setGit({ branchAuto: !g.branchAuto })} />
        </Box>
      )}
      {step === 2 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">How are commit messages written? The type comes from the task; the subject from your prompt.</Text>
          <Seg v={v} id="mp" value={g.msgPattern} items={MSG_PRESETS.map(p => [p.v, p.label] as [string, string])} onPick={k => setGit({ msgPattern: k })} />
          <Input key="git-mpat" label="Pattern" value={g.msgPattern} onInput={val => setGit({ msgPattern: val })} onSubmit={val => setGit({ msgPattern: val })} />
          <Text color={t.dim} size="footnote">{`{type} {subject} {Subject} {ticket} {branch} · e.g. ${commitMsg(sample, 'x')}`}</Text>
        </Box>
      )}
      {step === 3 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">What happens to changes Claude makes?</Text>
          {COMMIT_MODES.map(([id, label, desc]) => (
            <Box key={`cm-${id}`} columnGap={sp(v, 1)}>
              <Button key={`mode-${id}`} label={label} variant={g.commitMode === id ? 'primary' : 'secondary'} onPress={() => setGit({ commitMode: id })} />
              <Text color={t.dim} wrap="wrap">{desc}</Text>
            </Box>
          ))}
        </Box>
      )}
      {step === 4 && (
        <Box flexDirection="column" gap={sp(v, 1)}>
          <Text color={t.text} wrap="wrap">{g.commitMode === 'auto' ? 'When does Cockpit commit?' : 'When does Cockpit propose a commit?'}</Text>
          <Seg v={v} id="when" value={g.autoWhen} items={AUTO_WHENS.map(a => [a.v, a.label] as [string, string])} onPick={k => setGit({ autoWhen: k as GitForm['autoWhen'] })} />
          <Box flexWrap="wrap" columnGap={sp(v, 3)}>
            <Check v={v} id="opt-push" on={g.push} label="Push after commit" onPress={() => setGit({ push: !g.push })} />
            <Check v={v} id="opt-pr" on={g.pr} label="Open pull request" onPress={() => setGit({ pr: !g.pr })} />
            <Check v={v} id="opt-preTest" on={g.preTest} label="Only after the Verify experts pass" onPress={() => setGit({ preTest: !g.preTest })} />
          </Box>
        </Box>
      )}
      {nav}
    </Box>
  )
}

// Everything the setup asked, editable later
function Options($: $, v: V) {
  const { Box, Input, Select } = v.ui
  const { s } = v
  const g = s.git
  const setGit = (patch: Partial<GitForm>) => setGitPref($, patch)
  const bases = [...new Set([g.base || s.repo.current, ...s.repo.branches])].filter(Boolean)
  return (
    <Box flexDirection="column" gap={sp(v, 1)}>
      {AccountBox($, v)}
      <Box columnGap={sp(v, 2)} flexWrap="wrap">
        <Select key="git-mode" label="Mode" value={g.commitMode} options={COMMIT_MODES.map(([id, label]) => ({ value: id, label }))} onSelect={val => setGit({ commitMode: val as GitForm['commitMode'] })} />
        {g.commitMode !== 'manual' && <Select key="git-when" label="When" value={g.autoWhen} options={AUTO_WHENS.map(a => ({ value: a.v, label: a.label }))} onSelect={val => setGit({ autoWhen: val as GitForm['autoWhen'] })} />}
        {bases.length > 0 && <Select key="git-base" label="Base" value={g.base || s.repo.current} options={bases.map(b => ({ value: b }))} onSelect={val => setGit({ base: val })} />}
      </Box>
      <Input key="git-branch" label="Branch (blank: by the pattern)" placeholder={s.repo.current} value={g.branch} onInput={val => setGit({ branch: val })} onSubmit={val => setGit({ branch: val })} />
      <Input key="git-bpat" label="Branch pattern" value={g.branchPattern} onInput={val => setGit({ branchPattern: val, branchAuto: true })} onSubmit={val => setGit({ branchPattern: val, branchAuto: true })} />
      <Input key="git-mpat" label="Message pattern" value={g.msgPattern} onInput={val => setGit({ msgPattern: val })} onSubmit={val => setGit({ msgPattern: val })} />
      <Box columnGap={sp(v, 2)} flexWrap="wrap">
        <Input key="git-ticket" label="Ticket" value={g.ticket} onInput={val => setGit({ ticket: val })} onSubmit={val => setGit({ ticket: val })} />
        <Input key="git-user" label="User" value={g.user} onInput={val => setGit({ user: val })} onSubmit={val => setGit({ user: val })} />
      </Box>
      <Input key="git-body" label="Body" rows={2} value={g.body} onInput={val => setGit({ body: val })} onSubmit={val => setGit({ body: val })} />
      <Box flexWrap="wrap" columnGap={sp(v, 3)}>
        {GIT_OPTS.map(([key, label]) => (
          <Check key={`opt-${key}`} v={v} id={`opt-${key}`} on={!!g[key]} label={label} onPress={() => setGit({ [key]: !g[key] } as Partial<GitForm>)} />
        ))}
      </Box>
    </Box>
  )
}
