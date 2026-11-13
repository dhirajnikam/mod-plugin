// Every tab but its first lines sits behind one More fold (fold-more, fold-more-git, …): opens the one on screen, and
// gives back its key, or nothing when no closed More is drawn
export const openMore = async (ui: any): Promise<string | undefined> => {
  const key: string | undefined = (await ui.find({ type: 'Button', text: /› More/ }))?.key
  if (key) await ui.press({ key })
  return key
}

// What Cockpit itself drew at a site. The band above the prompt is one row per plugin, so the engine's stand-in row
// sits beside Cockpit's, each tagged with its plugin; a site drawn whole by one plugin carries no tag and is its own part
export const cockpitParts = (tree: unknown): unknown[] => {
  const found: unknown[] = []
  let tagged = false
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const el = n as { part?: { plugin?: string }; children?: unknown[] }
    if (el.part) {
      tagged = true
      if (el.part.plugin === 'cockpit') found.push(n)
      return
    }
    for (const k of Array.isArray(el.children) ? el.children : []) walk(k)
  }
  walk(tree)
  return tagged ? found : [tree]
}

// A process that ran: what `process.run` answers with
export const ok = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// The engine hands fs hooks native paths (C:\repo\a on Windows); the stand-ins match them as POSIX
export const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

// Cockpit's pane docked on the desktop, tall enough to draw a tab whole
export const deskPane = { plugin: 'cockpit', surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: { title: 'Cockpit', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} } }
