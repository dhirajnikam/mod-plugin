import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'
import type { Ph } from '../types'
import { compactNow, confirmPending, inBackground, openPane, set, skipPending } from './actions'
import { EXPERTS, PIPELINES, base, expertName, fmt, kTok, progress, tally, toOp, verifyState } from './logic'
import { INITIAL } from './state'
import { budgetLevel, todaySpend, withCurrent } from './spend'
import { chatThemeOf, ctxShades, themeOf } from './theme'
import { Card, seatDots } from './views'
import type { UI } from './views'

// Everything Cockpit draws around the chat: the spinner, the band above the prompt, the chat's cards and rows, and the
// line under the prompt (the side pane is pane.tsx). register.tsx calls this.
// The state atom is declared here too: the engine reads it from the module that names it
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-26' })

type Patch = Partial<Ph> | ((s: Ph) => Partial<Ph>)
// Where a card or a band label leads: the pane, opened on that tab, so a press shows what it names even when it is closed
async function show($: Parameters<typeof set>[0], patch: Patch) {
  await set($, patch)
  await openPane($)
}

// The step the task is on, as "3/5": the one in progress of its steps, when it has more than one
function stepAt(s: Ph) {
  const p = progress(s)
  const i = p.steps.findIndex(x => x.st === 'active')
  return i >= 0 && p.steps.length > 1 ? `${i + 1}/${p.steps.length}` : ''
}

// What the work around the chat is doing, in a few words: the agents running, the autopilot's cycle
function liveWords(s: Ph) {
  const running = s.agents.filter(a => a.status === 'running').length
  const ap = s.autopilot
  return [
    running ? `⧉ ${running} agent${running === 1 ? '' : 's'}` : '',
    ap?.status === 'running'
      ? `${ap.role === 'product' ? `◈ round ${ap.round ?? 1} · ` : '⟳ '}${ap.phase === 'scout' ? 'scouting' : `cycle ${ap.cycle}`}${ap.phase !== 'scout' && ap.total ? ` · ${ap.done}/${ap.total}` : ''}${ap.budget ? ` · $${(s.cost - ap.costAt).toFixed(2)}/$${ap.budget}` : ''}`
      : '',
    ap?.status === 'paused' ? (ap.role === 'product' ? '◈ product owner paused' : '⟳ autopilot paused') : '',
  ].filter(Boolean)
}

export function drawings(on: Parameters<Register>[0]) {
  // Activity line in place of the spinner: ✻ what is happening · elapsed
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const s = await read($, S)
    const mode = e.props.mode
    const what = s.waiting ? 'Waiting for your answer' : mode === 'thinking' ? 'Thinking' : mode === 'requesting' ? 'Sending' : mode === 'responding' ? 'Writing' : s.activity
    // Where the task stands: its step in progress, by number, so a long turn shows it is getting somewhere
    const at = stepAt(s)
    const step = progress(s).stepName
    // The desktop keeps its own row and takes only its words
    if (e.surface !== 'terminal') return next({ ...e, props: { ...e.props, message: at ? `${what} · step ${at}` : what } })
    const { Box, Text } = $.ui.resolve(e)
    const t = chatThemeOf(s)
    const now = await $.clock.now()
    const glyph = ['✻', '✼', '✽', '✾', '✽', '✼'][Math.floor(now / 180) % 6]
    return (
      <Box justifyContent="space-between" marginTop={1}>
        <Text>
          <Text color={t.accent}>{`${glyph} `}</Text>
          <Text color={t.text}>{what}</Text>
          {mode === 'thinking' && s.activity !== 'Done' && s.activity !== 'Reading the request' && <Text color={t.dim}>{` · after ${s.activity.toLowerCase()}`}</Text>}
        </Text>
        <Text>
          {at !== '' && <Text color={t.dim}>{`${step} ${at}  ·  `}</Text>}
          <Text color={t.dim}>{s.turnStart ? fmt(now - s.turnStart) : ''}</Text>
        </Text>
      </Box>
    )
  })

  // Band above the prompt: a box with Progress and Context, a Focus switch in its header; one line while Focus is on
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, S)
    const t = themeOf(s)
    const p = progress(s)
    const win = s.ctx.window || 200000
    const toggle = (
      <Button key="ph-focus" plain onPress={() => set($, st => ({ focus: st.focus === false }))}>
        <Text color={s.focus !== false ? t.accent : t.dim}>{s.focus !== false ? '◉ Focus' : '○ Focus'}</Text>
      </Button>
    )
    // The Verify experts in one phrase, for the one-line band
    const vs = verifyState(s.agents)
    const testsFail = vs.fail > 0
    const testsLine = vs.running ? 'testing…' : vs.cases.length ? `tests ${vs.pass}/${vs.cases.length}` : ''
    // Agents at work and the autopilot, which run on between prompts
    const live = liveWords(s)
    const liveLine = live.length > 0 && <Text color={t.dim}>{`  ·  ${live.join('  ·  ')}`}</Text>
    // A daily budget, once set: today's spend against it, amber from 80%, red from 100% (it only warns)
    const nowT = await $.clock.now().catch(() => Date.now())
    const today = todaySpend(withCurrent(s.pastSessions, s.sessionAt, nowT, s.cost, s.ctx.used, s.flows.length), nowT)
    const level = budgetLevel(today, s.dailyBudget)
    const budgetLine = level !== 'none' && <Text color={level === 'over' ? t.bad : level === 'near' ? t.busy : t.dim}>{`  ·  $${today.toFixed(2)} of $${s.dailyBudget!.toFixed(2)} today`}</Text>
    // A nearly full context: Compact, a press away, before Claude Code compacts it on its own
    const compact = s.ctx.pct >= 80 && (
      <Button key="ph-compact" plain onPress={() => inBackground($, 'compact', 'Compacting', () => compactNow($))}>
        <Text color={t.busy}>Compact</Text>
      </Button>
    )
    const pipe = s.pipeline && (
      <Text>
        <Text color={t.accent}>{'⧉ '}</Text>
        <Text color={t.text}>{`${PIPELINES.find(p => p.name === s.pipeline?.name)?.label ?? s.pipeline.name} pipeline`}</Text>
        <Text color={t.dim}>{` · ${s.pipeline.index + 1}/${s.pipeline.steps.length} · ${expertName(s.pipeline.steps[s.pipeline.index] ?? '')}…`}</Text>
      </Text>
    )
    // What the judges recommend, while the question waits for you: Claude's question, or this turn's next step
    const adv = s.decisions
      .slice()
      .reverse()
      .find(d => !!d.advice && d.status !== 'you' && (d.id === s.waiting || (d.kind === 'next' && d.at >= s.turnStart)))
    const advice = adv && (
      <Text wrap="truncate-end">
        <Text color={t.accent}>{'⚖ '}</Text>
        <Text color={t.text}>{adv.advice}</Text>
      </Text>
    )
    // A proposed commit waits for Commit or Skip right above the prompt
    const ask = s.pending && (
      <Box borderStyle="round" borderColor={t.accent} paddingX={1} justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Text>
          <Text color={t.busy}>{'⎇ Commit? '}</Text>
          <Text color={t.text} wrap="truncate-end">{s.pending.msg}</Text>
          <Text color={t.dim}>{` → ${s.pending.branch} · ${s.pending.files.length} files`}</Text>
        </Text>
        <Box gap={1}>
          <Button key="ph-commit" label="Commit" variant="primary" onPress={() => inBackground($, 'commit', 'Committing', () => confirmPending($))} />
          <Button key="ph-skip" label="Skip" onPress={() => skipPending($)} />
        </Box>
      </Box>
    )
    if (s.focus !== false) {
      return (
        <Box flexDirection="column" marginTop={1} backgroundColor={t.bg || undefined}>
        {ask}
        {advice}
        <Box borderStyle="round" borderColor={t.dim} paddingX={1} justifyContent="space-between" flexWrap="wrap">
          <Text>
            <Text color={t.text}>{p.steps.length > 0 && p.total > 0 ? `Step ${Math.min(p.done + 1, p.steps.length)} of ${p.steps.length}` : p.stepName}</Text>
            {p.steps.length > 0 && p.total > 0 && <Text color={t.dim}>{` · ${p.stepName}`}</Text>}
            {s.ctx.pct >= 50 && <Text color={s.ctx.pct >= 80 ? t.busy : t.dim}>{`  ·  context ${s.ctx.pct}%`}</Text>}
            {testsLine && <Text color={testsFail ? t.bad : testsLine === 'testing…' ? t.busy : t.ok}>{`  ·  ${testsLine}`}</Text>}
            {liveLine}
            {budgetLine}
          </Text>
          <Box columnGap={2}>
            {compact}
            {toggle}
          </Box>
        </Box>
        </Box>
      )
    }
    // Columns: label 10, bar, figures; border and padding take 4. Too narrow for that, the figures go above a full-width bar
    const right1 = `  ${p.pct}% · ${p.stepName}`
    const right2 = `  ${s.ctx.pct}% · ${kTok(s.ctx.used)} / ${kTok(win)}`
    const tail = Math.max(right1.length, right2.length)
    const inner = e.props.bodyColumns - 4
    const narrow = inner < 10 + 12 + tail
    const bw = narrow ? Math.max(6, inner) : inner - 10 - tail
    const gaps = p.steps.length - 1
    const segW = Math.max(1, Math.floor((bw - gaps) / p.steps.length))
    const shades = ctxShades(t)
    let left = bw
    const ctxCells = s.ctx.segs.map(([name, n], i) => {
      const k = Math.min(left, Math.round((n / win) * bw))
      left -= k
      return <Text key={`cx-${name}`} color={shades[i] ?? t.faint}>{'━'.repeat(k)}</Text>
    })
    const progressLabel = (
      <Button key="ph-progress" plain onPress={() => show($, { tab: 'overview' })}>
        <Text color={t.dim}>Progress</Text>
      </Button>
    )
    const contextLabel = (
      <Button key="ph-context" plain onPress={() => show($, { tab: 'overview' })}>
        <Text color={t.dim}>Context</Text>
      </Button>
    )
    return (
      <Box flexDirection="column" marginTop={1} backgroundColor={t.bg || undefined}>
        {ask}
        {advice}
        {pipe}
        <Box flexDirection="column" borderStyle="round" borderColor={t.dim} paddingX={1}>
          <Box justifyContent="space-between">
            <Text>
              <Text color={t.faint}>cockpit</Text>
              {liveLine}
            {budgetLine}
            </Text>
            <Box columnGap={2}>
              {compact}
              {toggle}
            </Box>
          </Box>
          {narrow && (
            <Box columnGap={1}>
              {progressLabel}
              <Text>
                <Text color={t.text}>{`${p.pct}%`}</Text>
                <Text color={t.dim}>{` · ${p.stepName}`}</Text>
              </Text>
            </Box>
          )}
          <Box>
            {!narrow && <Box width={10}>{progressLabel}</Box>}
            <Text mono>
            {p.steps.map((x, i) => {
              const k = x.st === 'done' ? segW : x.st === 'active' ? Math.max(1, Math.round(segW / 2)) : 0
              return (
                <Text key={`pg-${x.name}`}>
                  <Text color={t.accent}>{'━'.repeat(k)}</Text>
                  <Text color={t.track}>{(x.st === 'skipped' ? '╌' : '━').repeat(segW - k)}</Text>
                  {i < gaps && <Text> </Text>}
                </Text>
              )
            })}
            <Text color={t.track}>{'━'.repeat(Math.max(0, bw - segW * p.steps.length - gaps))}</Text>
            </Text>
            {!narrow && <Text color={t.text}>{`  ${p.pct}%`}</Text>}
            {!narrow && <Text color={t.dim}>{` · ${p.stepName}`}</Text>}
          </Box>
          {narrow && (
            <Box columnGap={1}>
              {contextLabel}
              <Text>
                <Text color={s.ctx.pct >= 80 ? t.busy : t.text}>{`${s.ctx.pct}%`}</Text>
                <Text color={t.dim}>{` · ${kTok(s.ctx.used)} / ${kTok(win)}`}</Text>
              </Text>
            </Box>
          )}
          <Box>
            {!narrow && <Box width={10}>{contextLabel}</Box>}
            <Text mono>
              {ctxCells}
              <Text color={t.track}>{'━'.repeat(Math.max(0, left))}</Text>
            </Text>
            {!narrow && <Text color={s.ctx.pct >= 80 ? t.busy : t.text}>{`  ${s.ctx.pct}%`}</Text>}
            {!narrow && <Text color={t.dim}>{` · ${kTok(s.ctx.used)} / ${kTok(win)}`}</Text>}
          </Box>
        </Box>
      </Box>
    )
  })

  // Chat cards: tool rows drawn as the design's cards; ctrl+o, errors and interrupts keep the engine's row
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    if (p.isExpanded || p.isErrored || p.isInterrupted) return next(e)
    const s = await read($, S)
    const t = chatThemeOf(s)
    const table = $.ui.resolve(e)
    if (s.focus !== false) return <table.Box display='none' />
    const ui = { Box: table.Box, Text: table.Text, Button: table.Button } as UI
    const { Text } = table
    const w = Math.max(30, (e.viewport?.columns ?? 100) - 4)
    const input = (p.input ?? {}) as Record<string, unknown>
    const id = e.requestId
    if (p.tool === 'AskUserQuestion') {
      const d = s.decisions.find(x => x.id.startsWith(`${id}-`))
      if (!d) return next(e)
      const open = () => show($, st => ({ tab: 'overview', ui: { ...st.ui, openDec: d.id } }))
      if (d.status === 'you') return <Card ui={ui} t={t} w={w} id={id} dashed={false} icon="⚖" left={<Text color={t.text}>You decided</Text>} right={d.result.replace(/^You chose · /, '')} onPress={open} />
      const tl = tally(d)
      const left = [<Text key="jn" color={t.text}>{`${tl.n || '…'} judges `}</Text>, ...seatDots(ui, t, d)]
      const right = d.status === 'voting' ? `voting ${tl.revealed}/${tl.n}` : d.status === 'scoring' ? 'scoring…' : d.status === 'split' ? 'split · asking you' : `${tl.yes}/${tl.n} → ${d.opts[tl.top] ?? ''}`
      return <Card ui={ui} t={t} w={w} id={id} dashed={false} icon="⚖" left={left} right={right} onPress={open} tone={d.status === 'split' || d.status === 'voting' || d.status === 'scoring' ? t.busy : undefined} />
    }
    if (p.tool === 'Agent' || p.tool === 'Task') {
      const task = String(input.description ?? input.prompt ?? '').split('\n')[0] ?? ''
      const type = String(input.subagent_type ?? 'Agent')
      const a = s.agents.filter(x => x.task === task).pop()
      // Running: its tool calls and time so far; finished: what its testers or its own CASE lines found
      const passed = a ? a.cases.filter(c => c.st === 'pass' || c.st === 'fixed').length : 0
      const failed = a ? a.cases.filter(c => c.st === 'fail').length : 0
      const live = p.isRunning || a?.status === 'running'
      const status = live
        ? `Running${a ? ` · ${a.tools} tool${a.tools === 1 ? '' : 's'} · ${fmt((await $.clock.now()) - a.startedAt)}` : ''}`
        : !a ? 'Done' : a.status !== 'done' ? { running: 'Running', done: 'Done', stopped: 'Stopped', failed: 'Failed' }[a.status] : a.cases.length ? (failed ? `✗ ${failed} failed · ${passed}/${a.cases.length}` : `✓ ${passed}/${a.cases.length} passed`) : 'Done'
      const tone = live ? t.busy : a?.status === 'failed' || failed ? t.bad : a?.status === 'stopped' ? t.dim : a?.cases.length ? t.ok : undefined
      return <Card ui={ui} t={t} w={w} id={id} dashed icon="⧉" left={<Text color={t.text} wrap="truncate-end">{`${EXPERTS.some(x => x.type === type) ? expertName(type) : `${type} subagent`} · ${task}`}</Text>} right={status} tone={tone} onPress={() => show($, st => ({ tab: 'agents', ui: { ...st.ui, openAgent: a?.id ?? '' } }))} />
    }
    if (p.tool === 'Bash' && /\bgit commit\b/.test(String(input.command)) && !p.isRunning) {
      const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '')
      const m = out.match(/\[[^\]\s]+ ([0-9a-f]{7,})\] ([^\n"]+)/)
      return <Card ui={ui} t={t} w={w} id={id} dashed={false} icon="⎇" left={<Text color={t.text} wrap="truncate-end">{m ? `Committed ${m[1]} · ${m[2]}` : 'Committed'}</Text>} right="" onPress={() => show($, { tab: 'git' })} />
    }
    const op = s.ops.find(o => o.id === id)
    if (!op) return next(e)
    // A file by its folder and name, so two files of one name read apart
    const name = op.op === 'Search' ? op.path : op.path.split(/[\\/]/).slice(-2).join('/')
    const right = p.isRunning ? '…' : op.add || op.del ? `+${op.add} −${op.del} →` : op.op === 'Read' ? '1 file →' : '→'
    return <Card ui={ui} t={t} w={w} id={id} dashed={op.op !== 'Delete'} icon="◇" left={<Text color={t.text} wrap="truncate-start">{`${op.op} ${name}`}</Text>} right={right} tone={p.isRunning ? t.busy : undefined} onPress={() => show($, st => ({ tab: 'files', ui: { ...st.ui, fileView: 'list', openFile: op.id } }))} />
  })

  // A folded run of reads and searches, as one card
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const ops = e.props.calls.map((c, i) => toOp(c.tool, (c.input ?? {}) as Record<string, unknown>, c.tool_use_id ?? `g${i}`, 0)).filter(o => o !== null)
    const s = await read($, S)
    const table = $.ui.resolve(e)
    if (s.focus !== false) return <table.Box display='none' />
    if (!ops.length) return next(e)
    const t = chatThemeOf(s)
    const ui = { Box: table.Box, Text: table.Text, Button: table.Button } as UI
    const text = ops.map(o => (o.op === 'Search' ? `Search ${o.path.split('  ')[1] ?? ''}` : `${o.op} ${base(o.path)}`)).join(' · ')
    const files = new Set(ops.filter(o => o.op !== 'Search').map(o => o.path)).size
    return <Card ui={ui} t={t} w={Math.max(30, (e.viewport?.columns ?? 100) - 4)} id={e.requestId} dashed icon="◇" left={<table.Text color={t.text} wrap="truncate-end">{text}</table.Text>} right={`${files || ops.length} ${files === 1 ? 'file' : 'files'} →`} onPress={() => show($, st => ({ tab: 'files', ui: { ...st.ui, fileView: 'list' } }))} />
  })

  // The line a finished turn leaves, as what it came to: ✻ Done · 3 files +40 −12 · tests 3/3 · $0.21 … 0:10. Kept
  // with Focus on, in one line: it is the turn's outcome, not its tool activity
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, S)
    const t = chatThemeOf(s)
    // A turn's flow is the one whose last turn the engine measured at this row's duration; one saved before flows kept
    // it is told by its clock times
    // ponytail: two turns of the same duration to the millisecond would both match
    const isLatest = Math.abs(e.props.durationMs - s.lastTurnMs) < 2500
    const ended = s.flows.filter(f => f.endedAt !== undefined)
    const f = ended.find(x => x.ms === e.props.durationMs) ?? ended.find(x => x.ms === undefined && Math.abs((x.endedAt ?? 0) - x.startedAt - e.props.durationMs) < 2500) ?? (isLatest ? ended[ended.length - 1] : undefined)
    // What the flow spent: the cost from its start to the next flow's start (one still running included), or to now
    const after = f ? s.flows[s.flows.indexOf(f) + 1] : undefined
    const spent = f?.costAt !== undefined ? (after?.costAt ?? s.cost) - f.costAt : 0
    const files = f ? new Set(s.ops.filter(o => o.at >= f.startedAt && o.at <= (f.endedAt ?? 0) && o.op !== 'Read' && o.op !== 'Search').map(o => o.path)).size : 0
    const vs = verifyState(s.agents)
    const word = f?.status === 'aborted' ? 'Stopped' : isLatest && s.repo.changed.length ? 'Done · ready to commit' : 'Done'
    return (
      <Box justifyContent="space-between" marginTop="md" width={Math.max(30, (e.viewport?.columns ?? 100) - 2)} columnGap={2}>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={f?.status === 'aborted' ? t.dim : t.accent}>✻ </Text>
            <Text color={t.text}>{word}</Text>
            {files > 0 && <Text color={t.dim}>{`  ·  ${files} file${files === 1 ? '' : 's'} `}</Text>}
            {f !== undefined && (f.add || f.del) > 0 && (
              <Text>
                {files === 0 && <Text color={t.dim}>{'  ·  '}</Text>}
                <Text color={t.ok}>{`+${f.add}`}</Text>
                <Text color={t.bad}>{` −${f.del}`}</Text>
              </Text>
            )}
            {isLatest && vs.cases.length > 0 && <Text color={vs.fail ? t.bad : t.ok}>{`  ·  tests ${vs.pass}/${vs.cases.length}`}</Text>}
            {spent >= 0.01 && <Text color={t.dim}>{`  ·  $${spent.toFixed(2)}`}</Text>}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={t.dim}>{fmt(e.props.durationMs)}</Text>
        </Box>
      </Box>
    )
  })

  // Your prompts as the design's "›" rows; notifications and ctrl+o keep the engine's own
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const t = chatThemeOf(await read($, S))
    return (
      <Box backgroundColor={t.surface || undefined} paddingX={1} marginTop="md" width={Math.max(30, (e.viewport?.columns ?? 100) - 2)}>
        <Text color={t.hi}>{'› '}</Text>
        <Text color={t.text}>{e.props.text}</Text>
      </Box>
    )
  })

  // Claude's replies with the design's "●" mark, markdown kept
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const table = $.ui.resolve(e)
    // A summary of the text between tool calls keeps the engine's row, which marks it as one
    if (!('Markdown' in table) || e.props.isSummary) return next(e)
    const { Box, Markdown, Text } = table
    const t = chatThemeOf(await read($, S))
    // A reply opens a row apart from the prompt or card above it, as the engine's own does
    return (
      <Box marginTop={e.props.isFirstOfReply ? 'md' : 0}>
        <Text color={t.accent}>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        <Box flexGrow={1}>
          <Markdown key="reply" text={e.props.text} />
        </Box>
      </Box>
    )
  })

  // Status row under the prompt: [cockpit] ⎇ branch ↑ahead · diff · tests · cost · mode
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, S)
    const t = chatThemeOf(s)
    const vs = verifyState(s.agents)
    const all = vs.cases
    const pass = vs.pass
    const fail = vs.fail
    const adds = s.repo.changed.reduce((a, c) => a + c.add, 0)
    const dels = s.repo.changed.reduce((a, c) => a + c.del, 0)
    return (
      <Box gap={2}>
        <Text color={t.hi}>{s.focus !== false ? '[cockpit · focus]' : '[cockpit]'}</Text>
        {s.repo.isRepo && <Text color={t.accent}>{`⎇ ${s.repo.current}${s.repo.ahead ? ` ↑${s.repo.ahead}` : ''}`}</Text>}
        {s.accounts.some(a => a.id === s.accountId) && <Text color={t.dim}>{`@ ${s.accounts.find(a => a.id === s.accountId)?.label}`}</Text>}
        {adds || dels ? (
          <Text>
            <Text color={t.ok}>{`+${adds}`}</Text>
            <Text color={t.bad}>{` −${dels}`}</Text>
          </Text>
        ) : (
          <Text color={t.dim}>no changes</Text>
        )}
        <Text color={fail ? t.bad : all.length ? t.ok : t.dim}>{`tests ${all.length ? `✓${pass}${fail ? ` ✗${fail}` : ''}/${all.length}` : '—'}`}</Text>
        <Text color={t.accent}>{`$${s.cost.toFixed(2)}`}</Text>
        <Text color={t.dim}>{s.mode === 'auto' ? 'Auto · judge' : s.mode === 'ask' ? 'Ask · advice' : 'Judges off'}</Text>
        {e.props.isWorking && <Text color={t.faint}>esc to interrupt</Text>}
      </Box>
    )
  })
}
