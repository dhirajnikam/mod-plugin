import type { Color, Register } from 'claude-code'

// Spinner text per phase of a turn; edit freely
const SPINNER: Record<string, string> = {
  requesting: 'sending',
  thinking: 'thinking',
  responding: 'writing',
  'tool-input': 'preparing tool',
  'tool-use': 'running tool',
}

// Status line: icon and colour per permission mode (colours are theme keys or '#rrggbb')
const MODES: Record<string, [string, Color]> = {
  default: ['●', 'subtle'],
  acceptEdits: ['⏵⏵', 'autoAccept'],
  plan: ['⏸', 'planMode'],
  auto: ['⚡', 'warning'],
  dontAsk: ['⛔', 'error'],
  bypassPermissions: ['☠', 'error'],
}
// ponytail: the live mode has no API, so it's read off the hint line's own text; breaks if that wording changes
const HINT_MODES: [RegExp, string][] = [
  [/plan mode/i, 'plan'],
  [/accept edits/i, 'acceptEdits'],
  [/auto mode/i, 'auto'],
  [/bypass/i, 'bypassPermissions'],
  [/don'?t ask/i, 'dontAsk'],
]
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const shortModel = (id: string) => id.replace(/^claude-/, '')

export const register: Register = on => {
  // Plain variables: render hooks may read them but not write state through $
  let mode = 'default'
  let model = ''
  let effort = ''

  on('session.start', async ($, e, next) => {
    model = shortModel(await $.session.model())
    return next(e)
  })

  // Replaces the spinner: no next(e), so the original line (and its "Claude" wording) never draws.
  // The desktop keeps its own row and takes only its words.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next({ ...e, props: { ...e.props, message: SPINNER[e.props.mode] ?? 'working' } })
    const { Text } = $.ui.resolve(e)
    return <Text color="suggestion">● {SPINNER[e.props.mode] ?? 'working'}…</Text>
  })

  // Replaces the hint line under the prompt with: mode · model · effort (· esc to interrupt)
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { hint, isDraft, isWorking } = e.props
    mode = HINT_MODES.find(([re]) => re.test(hint))?.[1] ?? (isDraft || isWorking ? mode : 'default')
    const [icon, color] = MODES[mode] ?? ['●', 'subtle']
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box gap={1}>
        <Text color={color}>{icon} {mode}</Text>
        {model && <Text dimColor>· {model}</Text>}
        {effort && <Text dimColor>· {effort}</Text>}
        {isWorking && <Text dimColor>· esc to interrupt</Text>}
      </Box>
    )
  })

  // Keep model and effort current, then redraw the line
  on('turn.step', async function* ($, e, next) {
    if (typeof e.effort === 'string' && e.effort !== effort) {
      effort = e.effort
      $.ui.invalidate('ui.render')
    }
    return yield* next(e)
  })

  on('config.set', async ($, e, next) => {
    const r = await next(e)
    if (e.key === 'model') {
      model = shortModel(await $.session.model())
      $.ui.invalidate('ui.render')
    }
    return r
  })

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const r = await next(e)
    model = shortModel(await $.session.model())
    $.ui.invalidate('ui.render')
    return r
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const level = e.args.trim()
    if (EFFORTS.includes(level)) {
      effort = level
      $.ui.invalidate('ui.render')
    }
    return r
  })
}
