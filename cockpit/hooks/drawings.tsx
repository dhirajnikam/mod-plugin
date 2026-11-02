import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'
import { commit, confirmPending, inBackground, judge, set, skipPending } from './actions'
import { PIPELINES, base, expertName, fmt, kTok, progress, tally, toOp, verifyState } from './logic'
import { INITIAL } from './state'
import { chatThemeOf, ctxShades, themeOf } from './theme'
import { Card, seatDots } from './views'
import type { UI } from './views'

// Everything Cockpit draws around the chat: the spinner, the band above the prompt, the chat's cards and rows, and the
// line under the prompt (the side pane is pane.tsx). register.tsx calls this.
// The state atom is declared here too: the engine reads it from the module that names it
const S = atom({ plugin: 'cockpit', key: 's' } as const, INITIAL, { shape: 'ph-23' })

export function drawings(on: Parameters<Register>[0]) {
  // Activity line in place of the spinner: ✻ what is happening · elapsed
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const s = await read($, S)
    const mode = e.props.mode
    const what = s.waiting ? 'Waiting for your answer' : mode === 'thinking' ? 'Thinking' : mode === 'requesting' ? 'Sending' : mode === 'responding' ? 'Writing' : s.activity
    // The desktop keeps its own row and takes only its words
    if (e.surface !== 'terminal') return next({ ...e, props: { ...e.props, message: what } })
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
        <Text color={t.dim}>{s.turnStart ? fmt(now - s.turnStart) : ''}</Text>
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
            <Text color={t.accent}>{`${p.pct}%`}</Text>
            <Text color={t.dim}>{` ${p.stepName}  ·  context `}</Text>
            <Text color={s.ctx.pct >= 80 ? t.busy : t.text}>{`${s.ctx.pct}%`}</Text>
            {testsLine && <Text color={testsFail ? t.bad : testsLine === 'testing…' ? t.busy : t.ok}>{`  ·  ${testsLine}`}</Text>}
          </Text>
          {toggle}
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
      <Button key="ph-progress" plain onPress={() => set($, { tab: 'overview' })}>
        <Text color={t.dim}>Progress</Text>
      </Button>
    )
    const contextLabel = (
      <Button key="ph-context" plain onPress={() => set($, { tab: 'overview' })}>
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
            <Text color={t.faint}>cockpit</Text>
            {toggle}
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
      const open = () => set($, st => ({ tab: 'overview', ui: { ...st.ui, openDec: d.id } }))
      if (d.status === 'you') return <Card ui={ui} t={t} w={w} id={id} dashed={false} icon="⚖" left={<Text color={t.text}>You decided</Text>} right={d.result.replace(/^You chose · /, '')} onPress={open} />
      const tl = tally(d)
      const left = [<Text key="jn" color={t.text}>{`${tl.n || '…'} judges `}</Text>, ...seatDots(ui, t, d)]
      const right = d.status === 'voting' ? `voting ${tl.revealed}/${tl.n}` : d.status === 'scoring' ? 'scoring…' : d.status === 'split' ? 'split · asking you' : `${tl.yes}/${tl.n} → ${d.opts[tl.top] ?? ''}`
      return <Card ui={ui} t={t} w={w} id={id} dashed={false} icon="⚖" left={left} right={right} onPress={open} />
    }
    if (p.tool === 'Agent' || p.tool === 'Task') {
      const task = String(input.description ?? input.prompt ?? '').split('\n')[0] ?? ''
      const type = String(input.subagent_type ?? 'Agent')
      const a = s.agents.filter(x => x.task === task).pop()
      const status = p.isRunning ? 'Running' : a ? { running: 'Running', done: 'Done', stopped: 'Stopped', failed: 'Failed' }[a.status] : 'Done'
      return <Card ui={ui} t={t} w={w} id={id} dashed icon="⧉" left={<Text color={t.text}>{`${type} subagent · ${task}`}</Text>} right={status} onPress={() => set($, st => ({ tab: 'agents', ui: { ...st.ui, openAgent: a?.id ?? '' } }))} />
    }
    if (p.tool === 'Bash' && /\bgit commit\b/.test(String(input.command)) && !p.isRunning) {
      const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '')
      const m = out.match(/\[[^\]\s]+ ([0-9a-f]{7,})\] ([^\n"]+)/)
      return <Card ui={ui} t={t} w={w} id={id} dashed={false} icon="⎇" left={<Text color={t.text}>{m ? `Committed ${m[1]} · ${m[2]}` : 'Committed'}</Text>} right="" onPress={() => set($, { tab: 'git' })} />
    }
    const op = s.ops.find(o => o.id === id)
    if (!op) return next(e)
    const name = op.op === 'Search' ? op.path : base(op.path)
    const right = p.isRunning ? '…' : op.add || op.del ? `+${op.add} −${op.del} →` : op.op === 'Read' ? '1 file →' : '→'
    return <Card ui={ui} t={t} w={w} id={id} dashed={op.op !== 'Delete'} icon="◇" left={<Text color={t.text}>{`${op.op} ${name}`}</Text>} right={right} onPress={() => set($, st => ({ tab: 'files', ui: { ...st.ui, fileView: 'list', openFile: op.id } }))} />
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
    return <Card ui={ui} t={t} w={Math.max(30, (e.viewport?.columns ?? 100) - 4)} id={e.requestId} dashed icon="◇" left={<table.Text color={t.text}>{text}</table.Text>} right={`${files || ops.length} ${files === 1 ? 'file' : 'files'} →`} onPress={() => set($, st => ({ tab: 'files', ui: { ...st.ui, fileView: 'list' } }))} />
  })

  // The line a finished turn leaves: ✻ Done … Done in m:ss
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, S)
    if (s.focus !== false) return <Box display='none' />
    const t = chatThemeOf(s)
    // ponytail: the latest turn is told by its duration matching the one turn.complete measured; two equal turns both match
    const isLatest = Math.abs(e.props.durationMs - s.lastTurnMs) < 2500
    return (
      <Box justifyContent="space-between" marginTop="md" width={Math.max(30, (e.viewport?.columns ?? 100) - 2)}>
        <Text>
          <Text color={t.accent}>✻ </Text>
          <Text color={t.text}>{isLatest && s.repo.changed.length ? 'Done · ready to commit' : 'Done'}</Text>
        </Text>
        <Text color={t.dim}>{`Done in ${fmt(e.props.durationMs)}`}</Text>
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
