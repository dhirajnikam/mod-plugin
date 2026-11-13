import type { Account } from '../../types'
import type { $ } from '../core/core'
import { look, set, toast } from '../core/core'
import { moveSaved, repoRoot, git } from '../core/repos'
import { firstLine } from '../core/text'

export async function gh($: $, args: string[], stdin?: string, cwd?: string) {
  return $.process.run(['gh', ...args], { env: { GH_PROMPT_DISABLED: '1' }, ...(stdin ? { stdin } : {}), ...(cwd ? { cwd } : {}) }).catch(e => ({ exitCode: 1, stdout: '', stderr: String(e) }))
}
// Push as a gh login: make it gh's active account, and have git ask gh for github.com's credentials, or git's own
// helper (Windows' manager) answers and the push goes out as whoever that remembers. '' when both worked, else why not
// Each runs whatever the other did: a switch gh refuses must not leave git asking its own helper
// ponytail: gh auth switch changes the machine's active GitHub account, not just this push; per-push tokens if that bites
export async function ghUse($: $, login: string) {
  const sw = await gh($, ['auth', 'switch', '-h', 'github.com', '--user', login])
  const sg = await gh($, ['auth', 'setup-git', '-h', 'github.com'])
  return [sw.exitCode !== 0 && `gh switch to ${login} failed: ${firstLine(sw)}`, sg.exitCode !== 0 && `gh setup-git failed: ${firstLine(sg)}`].filter(Boolean).join(' · ')
}
// A gh login just added: git set to use it, the accounts read again, and the new login (gh's active one) chosen
async function ghAdded($: $) {
  await gh($, ['auth', 'setup-git', '-h', 'github.com'])
  const login = (await gh($, ['api', 'user', '--jq', '.login'])).stdout.trim()
  await loadAccounts($)
  const s = await look($)
  const a = s.accounts.find(x => x.gh === login && x.id.startsWith('gh-')) ?? s.accounts.find(x => x.gh === login)
  if (a) await useAccount($, a.id)
  await set($, st => ({ ui: { ...st.ui, acctOpen: false } }))
  return login
}
// gh login with a personal access token (classic, scopes repo and read:org) on stdin; gh keeps it, Cockpit never does
export async function ghLoginToken($: $, token: string) {
  const tk = token.trim()
  await set($, st => ({ ui: { ...st.ui, ghToken: '' } }))
  if (!tk) return toast($, 'Paste a GitHub token first')
  const r = await gh($, ['auth', 'login', '--with-token', '-h', 'github.com', '-p', 'https'], `${tk}\n`)
  if (r.exitCode !== 0) return toast($, `gh login failed: ${firstLine(r)}`)
  const login = await ghAdded($)
  await toast($, `Logged in to GitHub as ${login || 'the token’s account'}`)
}
// gh login in the browser: gh copies a one-time code to the clipboard and waits on github.com/login/device; what it
// writes is streamed into the note, so the code shows even where the clipboard is not reachable
export async function ghLoginWeb($: $) {
  await set($, st => ({ ui: { ...st.ui, ghNote: 'Starting gh…' } }))
  void (async () => {
    let said = ''
    let ok = false
    const run = $.process.spawn({ argv: ['gh', 'auth', 'login', '--web', '--clipboard', '-h', 'github.com', '-p', 'https', '--skip-ssh-key'], env: { GH_PROMPT_DISABLED: '1' } })
    // Pulled by hand, not for-await: the stream's return value (how gh ended) is what a for-await drops
    for (let r = await run.next(); ; r = await run.next()) {
      if (r.done) {
        ok = r.value.code === 0
        break
      }
      said += r.value.text
      const code = said.match(/code[^A-Z0-9]*\(?([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1]
      const note = code ? `Open github.com/login/device and enter the code ${code} (also on your clipboard), then approve. Waiting for GitHub…` : said.trim().split('\n').pop() ?? ''
      await set($, st => ({ ui: { ...st.ui, ghNote: note } }))
    }
    const login = ok ? await ghAdded($) : ''
    await set($, st => ({ ui: { ...st.ui, ghNote: ok ? `Logged in as ${login}.` : `gh login ended: ${said.trim().split('\n').pop() ?? 'no output'}` } }))
  })().catch(async e => set($, st => ({ ui: { ...st.ui, ghNote: `gh could not start: ${String(e)}` } })))
}
// Accounts: the ones saved across sessions, plus the global git identity and each gh login found on this machine
export async function loadAccounts($: $) {
  const saved = ((await $.store.get('accounts')) as Account[] | undefined) ?? []
  await moveSaved($, 'account')
  const chosen = ((await $.store.get(`account:${await repoRoot($)}`)) as string | undefined) ?? ((await $.store.get('accountId')) as string | undefined) ?? ''
  const name = (await git($, ['config', '--global', 'user.name'])).stdout.trim()
  const email = (await git($, ['config', '--global', 'user.email'])).stdout.trim()
  const st = await gh($, ['auth', 'status', '-h', 'github.com'])
  const out = `${st.stdout}${st.stderr}`
  // One block per login: "Logged in to github.com account <login> ..." then its "- Active account: true|false"; a
  // login whose token gh can no longer use reads "Failed to log in to github.com account <login>" instead
  const parts = out.split(/(Logged in to |Failed to log in to )/)
  const blocks = parts.slice(1).flatMap((p, i, a) => (i % 2 === 0 ? [{ ok: p.startsWith('Logged'), text: a[i + 1] ?? '' }] : []))
  const loginOf = (b: { text: string }) => b.text.match(/account (\S+)/)?.[1] ?? ''
  const logins = blocks.filter(b => b.ok).map(loginOf).filter(Boolean)
  const stale = blocks.filter(b => !b.ok).map(loginOf).filter(Boolean)
  const act = blocks.find(b => b.ok && /Active account: true/.test(b.text))
  const active = act ? loginOf(act) : (logins[0] ?? '')
  // The global identity pushes as the login of its own name when there is one, else as gh's active login
  const mine = logins.find(l => l.toLowerCase() === name.toLowerCase()) ?? active
  const found: Account[] = []
  if (name || email) found.push({ id: 'global', label: mine || name || 'global', name, email, gh: mine })
  // Every other login commits as its GitHub name and its no-reply address, which GitHub links to the account
  const rest = logins.filter(l => l !== mine || !(name || email))
  const users = await Promise.all(rest.map(l => gh($, ['api', `users/${l}`, '--jq', '[.id, .name // ""] | @tsv'])))
  rest.forEach((l, i) => {
    const [uid = '', real = ''] = (users[i]?.exitCode === 0 ? users[i].stdout.trim() : '').split('\t')
    found.push({ id: `gh-${l}`, label: l, name: real || l, email: uid ? `${uid}+${l}@users.noreply.github.com` : `${l}@users.noreply.github.com`, gh: l })
  })
  const accounts = [...saved, ...found.filter(f => !saved.some(a => a.id === f.id))]
  // A login whose token stopped working is named in the box, so it is not just missing; the note clears once it is fixed
  const staleNote = stale.length ? `The GitHub token for ${stale.join(', ')} no longer works: add a new token, or log in with gh again.` : ''
  await set($, st => ({
    accounts,
    accountId: accounts.some(a => a.id === chosen) ? chosen : (accounts[0]?.id ?? ''),
    ui: st.ui.ghNote === '' || st.ui.ghNote.startsWith('The GitHub token for ') ? { ...st.ui, ghNote: staleNote } : st.ui,
  }))
}
// Remove an account from the machine, not only from the list (the next Detect would find it again): its gh login is
// logged out, and for the global identity git's global user.name and user.email are unset too
export async function removeAccount($: $, id: string) {
  await set($, st => ({ ui: { ...st.ui, acctRemove: '' } }))
  const a = (await look($)).accounts.find(x => x.id === id)
  if (!a) return
  const why: string[] = []
  if (a.gh) {
    const r = await gh($, ['auth', 'logout', '-h', 'github.com', '-u', a.gh])
    if (r.exitCode !== 0 && !/not logged in/i.test(firstLine(r))) why.push(`gh logout failed: ${firstLine(r)}`)
  }
  // Exit 5: the key was not set, which is what removing it wants
  if (id === 'global')
    for (const k of ['user.name', 'user.email']) {
      const r = await git($, ['config', '--global', '--unset', k])
      if (r.exitCode !== 0 && r.exitCode !== 5) why.push(`git config --unset ${k} failed: ${firstLine(r)}`)
    }
  const saved = ((await $.store.get('accounts')) as Account[] | undefined) ?? []
  await $.store.set('accounts', saved.filter(x => x.id !== id))
  await loadAccounts($)
  await toast($, why.length ? why.join(' · ') : `Removed ${a.label} from this machine`)
}
export async function useAccount($: $, id: string) {
  await set($, { accountId: id })
  await $.store.set('accountId', id)
  await $.store.set(`account:${await repoRoot($)}`, id)
}
export async function applyAccount($: $) {
  const s = await look($)
  const a = s.accounts.find(x => x.id === s.accountId)
  if (!a) return toast($, 'Pick an account first')
  const n = await git($, ['config', 'user.name', a.name])
  const m = n.exitCode === 0 ? await git($, ['config', 'user.email', a.email]) : n
  if (m.exitCode !== 0) return toast($, `Could not set the identity: ${firstLine(m)}`)
  await toast($, `This repo now commits as ${a.name} <${a.email}>`)
}
