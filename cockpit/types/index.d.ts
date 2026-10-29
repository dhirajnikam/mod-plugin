export type Palette = 'paper' | 'white' | 'black' | 'solarized' | 'nord'
// 'auto' follows Claude Code's own light or dark theme
export type ThemeId = 'auto' | Palette
export type Tab = 'overview' | 'files' | 'agents' | 'git'
export type Line = { t: string; k: 'a' | 'd' | 'c' }

// One file operation seen in a tool call
export type FileOp = {
  id: string
  op: 'Search' | 'Read' | 'Write' | 'Edit' | 'Delete'
  path: string
  at: number
  meta: string
  add: number
  del: number
  lines: Line[]
}

// One question Claude asked: decided by judges or by the person
export type Decision = {
  id: string
  q: string
  opts: string[]
  at: number
  score: number
  signals: string[]
  // -1 while a seat has not voted; else the option index it chose
  votes: number[]
  status: 'scoring' | 'voting' | 'decided' | 'split' | 'you'
  result: string
}

export type TestCase = { n: string; st: 'pass' | 'fail' | 'fixed' | 'run'; err?: string }
export type Agent = {
  id: string
  name: string
  type: string
  task: string
  prompt: string
  status: 'running' | 'done' | 'stopped' | 'failed'
  startedAt: number
  endedAt?: number
  tools: number
  log: { at: number; t: string }[]
  // From the agent's answer: its CASE lines (the testers), and its REPORT and HANDOFF lines (the experts)
  cases: TestCase[]
  report: string
  // A tester's run: the id of the agent whose work it tests
  for?: string
}

// A chain of experts on one task; each gets the reports of the ones before it
// for: the agent whose work a Verify pipeline tests
export type Pipeline = { name: string; steps: string[]; index: number; agentId: string; reports: string[]; at: number; for?: string }

export type GitForm = {
  branch: string
  branchAuto: boolean
  branchPattern: string
  ticket: string
  user: string
  base: string
  type: string
  scope: string
  subject: string
  body: string
  msgPattern: string
  // auto: commit by itself; ask: propose each commit for your Commit/Skip; manual: only the button
  commitMode: 'auto' | 'ask' | 'manual'
  autoWhen: 'tests' | 'step' | 'done'
  // The per-repository setup wizard has run
  setupDone: boolean
  breaking: boolean
  push: boolean
  pr: boolean
  draft: boolean
  signoff: boolean
  gpg: boolean
  preTest: boolean
}

// A git identity to commit as, and the GitHub login to push and open PRs with
export type Account = { id: string; label: string; name: string; email: string; gh: string }

// `from` is a rename's old path: it is committed with the new one
// A commit Cockpit proposes in ask mode, waiting for your Commit or Skip
export type Pending = { type: string; branch: string; msg: string; files: string[]; at: number }

// One prompt's work: its steps, time, changes, decisions and commit
export type Flow = {
  id: string
  task: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'aborted'
  reached: string[]
  ops: number
  add: number
  del: number
  decisions: number
  commit: string
  // A flow picked by hand (/cockpit flow, or the picker); else the words of the task choose
  kind?: string
}

export type Changed = { path: string; meta: string; add: number; del: number; from?: string }
export type Commit = { sha: string; msg: string; meta: string; auto: boolean }

export type Ph = {
  theme: ThemeId
  isDarkTerm: boolean
  // Focus: hide tool cards and turn lines, shrink the band to one line
  focus?: boolean
  tab: Tab
  mode: 'auto' | 'ask'
  task: string
  turnStart: number
  isWorking: boolean
  activity: string
  // Step index reached per step name; drives Progress
  reached: string[]
  // Every prompt's work, oldest first; the last one is the current flow
  flows: Flow[]
  ops: FileOp[]
  // Every path of the project, relative to the root: the Activity tree's skeleton
  project: string[]
  decisions: Decision[]
  waiting: string
  // Run the Verify experts after each turn that changes files
  autoVerify: boolean
  // Run the positive and the negative tester on each agent's run that changed files
  testAgents: boolean
  agents: Agent[]
  pipeline: Pipeline | null
  // What Cockpit is starting right now, for its agent.spawn hook to name the record by
  starting: { name: string; type: string; task: string } | null
  // Agent types the form can start: built-ins, agents/*.md files found, and any seen starting
  agentTypes: string[]
  // Agents made from a description in the pane, as cockpit:<name>; their definitions are kept in the store
  custom: { type: string; name: string; what: string }[]
  // A description being turned into an agent right now
  creating: string
  git: GitForm
  // log: the repository's recent commits, newest first
  repo: { isRepo: boolean; current: string; ahead: number; changed: Changed[]; branches: string[]; log: { sha: string; msg: string; when: string }[] }
  staged: Record<string, boolean>
  pending: Pending | null
  commits: Commit[]
  accounts: Account[]
  accountId: string
  // How long the last main turn took, to tell its "Done in" line from older ones
  lastTurnMs: number
  ctx: { pct: number; used: number; window: number; segs: [string, number][] }
  cost: number
  ui: {
    openFile: string
    openDec: string
    openAgent: string
    openFlow: string
    fileView: 'tree' | 'list'
    collapsed: Record<string, boolean>
    treeSel: string
    more: boolean
    spawnOpen: boolean
    spawnTask: string
    spawnType: string
    describe: string
    acctOpen: boolean
    acct: Account
    // The setup wizard's step, the token being typed, and the gh web login's note
    gitStep: number
    ghToken: string
    ghNote: string
  }
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { s: Shaped<Ph> }
  }
}
