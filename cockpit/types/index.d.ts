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
  status: 'scoring' | 'voting' | 'decided' | 'split' | 'you' | 'advised'
  result: string
  // What the judges recommend where they only advise (Ask me mode, or a decision that is hard to undo)
  advice?: string
  // question: Claude's question tool; next: the app's next-step box at the end of a turn
  kind?: 'question' | 'next'
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
  // Claude's own task list for this prompt (TodoWrite, or TaskCreate and TaskUpdate): the flow's steps while it has one
  plan?: PlanItem[]
  // Steps written for this prompt's task, each tagged with the kind of work that reaches it
  steps?: { name: string; kind: string }[]
  // Turns this flow ran: more than one when a /goal, a background task or another plugin carried it on
  turns?: number
}

export type PlanItem = { id: string; text: string; st: 'pending' | 'in_progress' | 'completed' }

// One commit of the graph: refs as `git log %D` names them (HEAD -> main, origin/main, tag: v1)
export type LogCommit = { sha: string; parents: string[]; refs: string[]; msg: string; when: string; author: string }

export type Changed = { path: string; meta: string; add: number; del: number; from?: string }
export type Commit = { sha: string; msg: string; meta: string; auto: boolean }

export type Ph = {
  theme: ThemeId
  isDarkTerm: boolean
  // Focus: hide tool cards and turn lines, shrink the band to one line
  focus?: boolean
  tab: Tab
  // auto: the judges decide (risky decisions they only advise on); ask: they advise, you decide; off: no judges
  mode: 'auto' | 'ask' | 'off'
  task: string
  // The completion condition set by /goal or Claude's ProposeGoal, while one stands
  goal?: { text: string; at: number }
  turnStart: number
  isWorking: boolean
  activity: string
  // Step index reached per step name; drives Progress
  reached: string[]
  // Every prompt's work, oldest first; the last one is the current flow
  flows: Flow[]
  // Earlier sessions' flows and agent runs, read from the repository's .cockpit/history.json
  past: Flow[]
  pastAgents: Agent[]
  // Runs you cleared from the list (the engine still lists them, so a sync must not bring them back), and when: a team
  // row shows no run older than that
  cleared: string[]
  clearedAt: number
  // When you last sent a prompt of your own, and how many next steps the judges answered since: kept in state, so a
  // reload does not forget a late answer or reset the count
  personAt: number
  judgedRun: number
  // The codebase memory: each source file (from the repository root) and the files it imports; at: when it was built
  memory: {
    at: number
    files: Record<string, string[]>
    // The product's features as a model named them from what each file exports, and the file set they were named for
    features?: { name: string; what: string; files: string[] }[]
    sig?: string
    // A model is naming them now
    naming?: boolean
  }
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
  // log: the recent commits of every branch, remote and tag, in graph order; unpushed: the current branch's commits its upstream lacks
  repo: { isRepo: boolean; current: string; ahead: number; behind: number; changed: Changed[]; branches: string[]; log: LogCommit[]; unpushed: string[] }
  staged: Record<string, boolean>
  pending: Pending | null
  // The commit a model wrote from the diff of the ticked files (sig names them and their counts); busy while it writes
  suggest?: { sig: string; type: string; subject: string; busy?: boolean }
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
    // The commit opened in the graph, and what git show said of it
    openCommit: string
    commitInfo: string
    fileView: 'tree' | 'list'
    collapsed: Record<string, boolean>
    treeSel: string
    more: boolean
    spawnOpen: boolean
    spawnTask: string
    spawnType: string
    describe: string
    // Agents ticked on the team list, and the task to run them with ('' is the current one)
    selected: Record<string, boolean>
    runTask: string
    // Clear was pressed and waits for its confirmation
    confirmClear: boolean
    // The feature opened in the Activity tab's memory
    openFeature: string
    // The run (an agent id) or team agent (type:<type>) being run again with your instructions, and those instructions
    rerunFor: string
    rerunText: string
    acctOpen: boolean
    acct: Account
    // The account whose Remove was pressed, waiting for its confirmation
    acctRemove?: string
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
