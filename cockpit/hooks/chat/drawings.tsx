
import type { Register, RenderNode } from 'claude-code'
import type { Decision, Ph } from '../../types'
import { set, look, inBackground } from '../core/core'
import { progress, stepNo, autopilotWords } from '../flows/flows'
import type { Theme } from '../core/theme'
import { chatThemeOf, themeOf, ctxShades, ctxLevel, ctxColor } from '../core/theme'
import { INITIAL } from '../core/state'
import { fmt, kTok, base, plural } from '../core/text'
import { verifyState, PIPELINES, expertName, EXPERTS, passedOf } from '../agents/experts'
import { STATUS_WORD } from '../agents/agents-view'
import { todaySpend, sessionsNow, budgetLevel } from '../core/spend'
import { compactNow } from '../core/session'
import { tally } from '../judges/judges'
import { toOp } from '../flows/tools'
import { showTab } from '../pane/tabs'
import type { UI } from '../ui/shared'
import { Segs, Diff } from '../ui/shared'
import { CommitSkip } from '../git/git-tab'
import { modeOf } from '../core/modes'

function stepAt(s: Ph) {
  const p = progress(s)
  const at = stepNo(p)
  // The spinner names a step only while one is in progress
  return at && p.active > 0 && at.of > 1 ? `${at.n}/${at.of}` : ''
}

// What the work around the chat is doing, in a few words: the agents running, the autopilot's cycle
function liveWords(s: Ph) {
  const running = s.agents.filter(a => a.status === 'running').length
  const ap = s.autopilot
  const live = ap?.status === 'running'
  const building = live && !(ap.role === 'product' && ap.phase === 'scout')
  return [
    running ? `⧉ ${plural(running, 'agent')}` : '',
    // Only work under way or waiting on you is named here; running, with its milestones and its spend against a budget
    ap && (live || ap.status === 'paused') ? `${autopilotWords(ap)}${building && ap.total ? ` · ${ap.done}/${ap.total}` : ''}${live && ap.budget ? ` · $${(s.cost - ap.costAt).toFixed(2)}/$${ap.budget}` : ''}` : '',
  ].filter(Boolean)
}

// A chat row's width: the viewport's, less the row's inset, and never too narrow to draw in
const chatW = (e: { viewport?: { columns?: number } | undefined }, inset: number) => Math.max(30, (e.viewport?.columns ?? 100) - inset)

type ChatUI = Pick<UI, 'Box' | 'Text' | 'Button'>

// A card in the chat, as the design draws tool activity: icon, text, figures on the right
// tone: the colour of the right-hand words, by what they say (a pass, a failure, work still running)
function Card({ ui, t, w, id, dashed, icon, left, right, onPress, tone }: { ui: ChatUI; t: Theme; w: number; id: string; dashed: boolean; icon: string; left: RenderNode | RenderNode[]; right: string; onPress: () => unknown; tone?: string }) {
  const { Box, Button, Text } = ui
  return (
    <Box borderStyle={dashed ? 'dashed' : 'round'} borderColor={t.lo} paddingX={1} marginTop="md" width={w} justifyContent="space-between" columnGap={2}>
      <Box flexShrink={1}>
        <Text color={t.hi}>{`${icon} `}</Text>
        <Button key={`card-${id}`} plain onPress={onPress}>
          {left}
        </Button>
      </Box>
      <Box flexShrink={0}>
        <Text color={tone ?? t.hi}>{right}</Text>
      </Box>
    </Box>
  )
}

function seatDots(ui: ChatUI, t: Theme, d: Decision) {
  const { Text } = ui
  const top = tally(d).top
  return d.votes.map((v, i) => (
    <Text key={`dot-${d.id}-${i}`} color={v < 0 ? t.faint : v === top ? t.ok : t.dim}>{v < 0 || v !== top ? '○' : '●'}</Text>
  ))
}

// Everything Cockpit draws around the chat: the spinner, the band above the prompt, the chat's cards and rows, and the
// line under the prompt (the side pane is pane/full-pane.tsx)
export function drawings(on: Parameters<Register>[0]) {
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const s = await look($)
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
    const s = await look($)
    const t = themeOf(s)
    const p = progress(s)
    const step = stepNo(p)
    const win = s.ctx.window || INITIAL.ctx.window
    const toggle = (
      <Button key="ph-focus" plain onPress={() => set($, st => ({ focus: st.focus === false }))}>
        <Text color={s.focus !== false ? t.accent : t.dim}>{s.focus !== false ? '◉ Focus' : '○ Focus'}</Text>
      </Button>
    )
    const vs = verifyState(s.agents)
    const testsFail = vs.fail > 0
    const testsLine = vs.running ? 'testing…' : vs.cases.length ? `tests ${passedOf(vs.cases)}/${vs.cases.length}` : ''
    const live = liveWords(s)
    const liveLine = live.length > 0 && <Text color={t.dim}>{`  ·  ${live.join('  ·  ')}`}</Text>
    // A daily budget, once set: today's spend against it, amber from 80%, red from 100% (it only warns)
    const nowT = await $.clock.now().catch(() => Date.now())
    const today = todaySpend(sessionsNow(s, nowT), nowT)
    const level = budgetLevel(today, s.dailyBudget)
    const budgetLine = level !== 'none' && <Text color={level === 'over' ? t.bad : level === 'near' ? t.busy : t.dim}>{`  ·  $${today.toFixed(2)} of $${s.dailyBudget!.toFixed(2)} today`}</Text>
    // A nearly full context: Compact, a press away, before Claude Code compacts it on its own
    const compact = ctxLevel(s.ctx.pct) === 'bad' && (
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
    const ask = s.pending && (
      <Box borderStyle="round" borderColor={t.accent} paddingX={1} justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Text>
          <Text color={t.busy}>{'⎇ Commit? '}</Text>
          <Text color={t.text} wrap="truncate-end">{s.pending.msg}</Text>
          <Text color={t.dim}>{` → ${s.pending.branch} · ${s.pending.files.length} files`}</Text>
        </Text>
        {CommitSkip($, { Box, Button }, 'ph', 1)}
      </Box>
    )
    if (s.focus !== false) {
      return (
        <Box flexDirection="column" marginTop={1} backgroundColor={t.bg || undefined}>
        {ask}
        {advice}
        <Box borderStyle="round" borderColor={t.dim} paddingX={1} justifyContent="space-between" flexWrap="wrap">
          <Text>
            <Text color={t.text}>{step ? `Step ${step.n} of ${step.of}` : p.stepName}</Text>
            {step && <Text color={t.dim}>{` · ${p.stepName}`}</Text>}
            {ctxLevel(s.ctx.pct) !== 'ok' && <Text color={ctxColor(t, s.ctx.pct, t.dim)}>{`  ·  context ${s.ctx.pct}%`}</Text>}
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
    const progressLabel = (
      <Button key="ph-progress" plain onPress={() => showTab($, 'overview')}>
        <Text color={t.dim}>Progress</Text>
      </Button>
    )
    const contextLabel = (
      <Button key="ph-context" plain onPress={() => showTab($, 'overview')}>
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
                <Text color={ctxColor(t, s.ctx.pct, t.text)}>{`${s.ctx.pct}%`}</Text>
                <Text color={t.dim}>{` · ${kTok(s.ctx.used)} / ${kTok(win)}`}</Text>
              </Text>
            </Box>
          )}
          <Box>
            {!narrow && <Box width={10}>{contextLabel}</Box>}
            <Segs ui={{ Text }} w={bw} track={t.track} parts={s.ctx.segs.map(([, n], i) => [n / win, shades[i] ?? t.faint])} />
            {!narrow && <Text color={ctxColor(t, s.ctx.pct, t.text)}>{`  ${s.ctx.pct}%`}</Text>}
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
    const s = await look($)
    const t = chatThemeOf(s)
    const table = $.ui.resolve(e)
    if (s.focus !== false) return <table.Box display='none' />
    const { Text } = table
    const w = chatW(e, 4)
    const input = (p.input ?? {}) as Record<string, unknown>
    const id = e.requestId
    if (p.tool === 'AskUserQuestion') {
      const d = s.decisions.find(x => x.id.startsWith(`${id}-`))
      if (!d) return next(e)
      const open = () => showTab($, 'overview', { openDec: d.id })
      if (d.status === 'you') return <Card ui={table} t={t} w={w} id={id} dashed={false} icon="⚖" left={<Text color={t.text}>You decided</Text>} right={d.result.replace(/^You chose · /, '')} onPress={open} />
      const tl = tally(d)
      const left = [<Text key="jn" color={t.text}>{`${tl.n || '…'} judges `}</Text>, ...seatDots(table, t, d)]
      const right = d.status === 'voting' ? `voting ${tl.revealed}/${tl.n}` : d.status === 'scoring' ? 'scoring…' : d.status === 'split' ? 'split · asking you' : `${tl.yes}/${tl.n} → ${d.opts[tl.top] ?? ''}`
      return <Card ui={table} t={t} w={w} id={id} dashed={false} icon="⚖" left={left} right={right} onPress={open} tone={d.status === 'split' || d.status === 'voting' || d.status === 'scoring' ? t.busy : undefined} />
    }
    if (p.tool === 'Agent' || p.tool === 'Task') {
      const task = String(input.description ?? input.prompt ?? '').split('\n')[0] ?? ''
      const type = String(input.subagent_type ?? 'Agent')
      const a = s.agents.filter(x => x.task === task).pop()
      // Running: its tool calls and time so far; finished: what its testers or its own CASE lines found
      const passed = a ? passedOf(a.cases) : 0
      const failed = a ? a.cases.filter(c => c.st === 'fail').length : 0
      const live = p.isRunning || a?.status === 'running'
      const status = live
        ? `Running${a ? ` · ${plural(a.tools, 'tool')} · ${fmt((await $.clock.now()) - a.startedAt)}` : ''}`
        : !a || a.status !== 'done' || !a.cases.length ? STATUS_WORD[a?.status ?? 'done'] : failed ? `✗ ${failed} failed · ${passed}/${a.cases.length}` : `✓ ${passed}/${a.cases.length} passed`
      const tone = live ? t.busy : a?.status === 'failed' || failed ? t.bad : a?.status === 'stopped' ? t.dim : a?.cases.length ? t.ok : undefined
      return <Card ui={table} t={t} w={w} id={id} dashed icon="⧉" left={<Text color={t.text} wrap="truncate-end">{`${EXPERTS.some(x => x.type === type) ? expertName(type) : `${type} subagent`} · ${task}`}</Text>} right={status} tone={tone} onPress={() => showTab($, 'agents', { openAgent: a?.id ?? '' })} />
    }
    if (p.tool === 'Bash' && /\bgit commit\b/.test(String(input.command)) && !p.isRunning) {
      const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '')
      const m = out.match(/\[[^\]\s]+ ([0-9a-f]{7,})\] ([^\n"]+)/)
      return <Card ui={table} t={t} w={w} id={id} dashed={false} icon="⎇" left={<Text color={t.text} wrap="truncate-end">{m ? `Committed ${m[1]} · ${m[2]}` : 'Committed'}</Text>} right="" onPress={() => showTab($, 'git')} />
    }
    const op = s.ops.find(o => o.id === id)
    if (!op) return next(e)
    // A file by its folder and name, so two files of one name read apart
    const name = op.op === 'Search' ? op.path : op.path.split(/[\\/]/).slice(-2).join('/')
    const right = p.isRunning ? '…' : op.add || op.del ? `+${op.add} −${op.del} →` : op.op === 'Read' ? '1 file →' : '→'
    return <Card ui={table} t={t} w={w} id={id} dashed={op.op !== 'Delete'} icon="◇" left={<Text color={t.text} wrap="truncate-start">{`${op.op} ${name}`}</Text>} right={right} tone={p.isRunning ? t.busy : undefined} onPress={() => showTab($, 'files', { openFile: op.id })} />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const ops = e.props.calls.map((c, i) => toOp(c.tool, (c.input ?? {}) as Record<string, unknown>, c.tool_use_id ?? `g${i}`, 0)).filter(o => o !== null)
    const s = await look($)
    const table = $.ui.resolve(e)
    if (s.focus !== false) return <table.Box display='none' />
    if (!ops.length) return next(e)
    const t = chatThemeOf(s)
    const text = ops.map(o => (o.op === 'Search' ? `Search ${o.path.split('  ')[1] ?? ''}` : `${o.op} ${base(o.path)}`)).join(' · ')
    const files = new Set(ops.filter(o => o.op !== 'Search').map(o => o.path)).size
    return <Card ui={table} t={t} w={chatW(e, 4)} id={e.requestId} dashed icon="◇" left={<table.Text color={t.text} wrap="truncate-end">{text}</table.Text>} right={`${files || ops.length} ${files === 1 ? 'file' : 'files'} →`} onPress={() => showTab($, 'files')} />
  })

  // The line a finished turn leaves, as what it came to: ✻ Done · 3 files +40 −12 · tests 3/3 · $0.21 … 0:10. Kept
  // with Focus on, in one line: it is the turn's outcome, not its tool activity
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = await look($)
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
      <Box justifyContent="space-between" marginTop="md" width={chatW(e, 2)} columnGap={2}>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={f?.status === 'aborted' ? t.dim : t.accent}>✻ </Text>
            <Text color={t.text}>{word}</Text>
            {files > 0 && <Text color={t.dim}>{`  ·  ${plural(files, 'file')} `}</Text>}
            {f !== undefined && (f.add || f.del) > 0 && (
              <Text>
                {files === 0 && <Text color={t.dim}>{'  ·  '}</Text>}
                <Text color={t.ok}>{`+${f.add}`}</Text>
                <Text color={t.bad}>{` −${f.del}`}</Text>
              </Text>
            )}
            {isLatest && vs.cases.length > 0 && <Text color={vs.fail ? t.bad : t.ok}>{`  ·  tests ${passedOf(vs.cases)}/${vs.cases.length}`}</Text>}
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
    const t = chatThemeOf(await look($))
    return (
      <Box backgroundColor={t.surface || undefined} paddingX={1} marginTop="md" width={chatW(e, 2)}>
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
    const t = chatThemeOf(await look($))
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

  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await look($)
    const t = chatThemeOf(s)
    const vs = verifyState(s.agents)
    const all = vs.cases
    const pass = passedOf(vs.cases)
    const fail = vs.fail
    const adds = s.repo.changed.reduce((a, c) => a + c.add, 0)
    const dels = s.repo.changed.reduce((a, c) => a + c.del, 0)
    return (
      <Box gap={2}>
        <Text color={t.hi}>{s.focus !== false ? '[cockpit · focus]' : '[cockpit]'}</Text>
        {s.repo.isRepo && <Text color={t.accent}>{`⎇ ${s.repo.current}${s.repo.ahead ? ` ↑${s.repo.ahead}` : ''}`}</Text>}
        {s.accounts.some(a => a.id === s.accountId) && <Text color={t.dim}>{`@ ${s.accounts.find(a => a.id === s.accountId)?.label}`}</Text>}
        {adds || dels ? (
          <Diff ui={{ Text }} t={t} add={adds} del={dels} />
        ) : (
          <Text color={t.dim}>no changes</Text>
        )}
        <Text color={fail ? t.bad : all.length ? t.ok : t.dim}>{`tests ${all.length ? `✓${pass}${fail ? ` ✗${fail}` : ''}/${all.length}` : '—'}`}</Text>
        <Text color={t.accent}>{`$${s.cost.toFixed(2)}`}</Text>
        <Text color={t.dim}>{modeOf(s.mode).status}</Text>
        {e.props.isWorking && <Text color={t.faint}>esc to interrupt</Text>}
      </Box>
    )
  })
}
