import { addUsage, jevRequest, jevDecision, formatSnapshot, formatAll, formatTree, statusLine, paneTree, fleetTree, parseSender, jevProb, DETAILS_PREV, DETAILS_NEXT } from './lib.js'

const KEY_PREFIX = 'session:'
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_TIMEOUT_MS = 3000

// Per-session state. One $.store key per session avoids the cross-session
// write race the docs warn about.
let session = null
let main = { model: null, tokens: {}, updatedAt: null }
let workers = {}
let endedAt = null
// Messages exchanged with other sessions or teammates: the cross-session edges.
let links = []
const LINKS_MAX = 50
// Recent spawn/done events for the pane's log.
let events = []
const EVENTS_MAX = 40
const PANE = 'agent-tree'
let paneOpened = false
// Session pane view state: graph or cards, horizontal window, selected agent.
let paneMode = 'graph'
let paneOffset = null
let selectedAgent = ''
// Which page of agents the details picker lists (a Select holds 64 options at most).
let detailsPage = 0
const FLEET = 'agent-tree-fleet'
let fleetFilterState = { repo: '', running: false, worktree: false }
let jevKey = null
let jevKeyReason = null
// AGENT_TREE_JEV=all widens Jev from factory:* agents to every spawn. Read once per session.
let jevScope = null

// After a reload the module starts empty: read this session's record back
// so running workers keep their type, name and history.
async function hydrate($) {
  const s = await ensureSession($)
  const saved = await $.store.get(KEY_PREFIX + s.id)
  if (!saved || typeof saved !== 'object') return
  if (saved.workers && Object.keys(workers).length === 0) workers = saved.workers
  if (saved.main && !main.steps) main = saved.main
  if (Array.isArray(saved.links) && !links.length) links = saved.links
  if (Array.isArray(saved.events) && !events.length) events = saved.events
  await resolveUnknown($)
}

// Workers recorded as `unknown` (seen only after a reload) get a second
// chance: Claude Code still lists the running ones.
async function resolveUnknown($) {
  const ids = Object.entries(workers).filter(([, w]) => w.type === 'unknown').map(([id]) => id)
  if (!ids.length) return
  let list = []
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  for (const id of ids) {
    const info = list.find((a) => a.id === id)
    if (!info) continue
    workers = { ...workers, [id]: { ...workers[id], type: info.type, description: info.description, parentAgentId: info.parentId ?? workers[id].parentAgentId ?? null } }
  }
}

// After /resume, /branch or agent view, the session gets a new id but its
// transcript is a copy of the old one, whose rows still carry the old
// `sessionId`. Adopt that session's record so the graph survives the switch.
async function adoptFromTranscript($, transcriptPath) {
  const s = await ensureSession($)
  let head = ''
  try {
    const r = await $.process.run(['head', '-c', '400000', transcriptPath], { timeoutMs: 5000 })
    head = r.stdout
  } catch {
    return null
  }
  const ids = new Set()
  for (const m of head.matchAll(/"sessionId":"([0-9a-f-]{36})"/g)) ids.add(m[1])
  ids.delete(s.id)
  for (const oldId of ids) {
    const saved = await $.store.get(KEY_PREFIX + oldId)
    if (!saved || typeof saved !== 'object' || !Object.keys(saved.workers ?? {}).length) continue
    workers = saved.workers
    main = saved.main ?? main
    links = Array.isArray(saved.links) ? saved.links : links
    events = Array.isArray(saved.events) ? saved.events : events
    session = { ...s, resumedFrom: oldId }
    await save($)
    return oldId
  }
  return null
}

// A worker the module never saw spawn (reload, or a loop started elsewhere):
// ask Claude Code who it is.
async function describeAgent($, agentId) {
  try {
    const info = (await $.agent.list()).find((a) => a.id === agentId)
    if (info) return { type: info.type, description: info.description, parentAgentId: info.parentId ?? null }
  } catch {
    // fall through to unknown
  }
  return { type: 'unknown', description: '', parentAgentId: null }
}

async function ensureSession($) {
  if (session) return session
  const repo = await $.session.repo()
  // Orca tags say which workspace / worktree pane started this session.
  const workspace = await $.env.get('ORCA_WORKSPACE_ID')
  const worktree = await $.env.get('ORCA_WORKTREE_ID')
  const pane = await $.env.get('ORCA_PANE_KEY')
  // The address other sessions use to message this one (uds:<socket path>).
  const socket = await $.env.get('CLAUDE_CODE_MESSAGING_SOCKET')
  session = {
    socket: socket ? 'uds:' + socket : null,
    id: await $.session.id(),
    cwd: await $.session.cwd(),
    repo: repo ? { root: repo.root, name: repo.name, remote: repo.remote } : null,
    orca: workspace || worktree || pane ? { workspace: workspace ?? null, worktree: worktree ?? null, pane: pane ?? null } : null,
    startedAt: await $.clock.now(),
  }
  return session
}

async function save($) {
  const s = await ensureSession($)
  const now = await $.clock.now()
  await $.store.set(KEY_PREFIX + s.id, { ...s, updatedAt: now, endedAt, main, workers, links, events })
  updateStatus($)
  $.ui.invalidate('ui.render')
}

function pushEvent(ev) {
  events = [...events, ev].slice(-EVENTS_MAX)
}

async function openPane($, focus) {
  paneOpened = true
  // rows: height when above the prompt; columns: width when docked beside the transcript.
  const placed = await $.ui.open(focus ? { id: PANE, title: 'agent-tree', focus: true, closeOnEscape: true, rows: 28, columns: 100 } : { id: PANE, title: 'agent-tree', rows: 28, columns: 100 })
  if (placed && placed.isPlaced === false) $.ui.toast('agent-tree: pane needs a wider terminal; /agent-tree open')
}

// One line under the prompt while workers exist: the always-visible monitor.
function updateStatus($) {
  const line = statusLine(workers)
  if (line) $.ui.status(line)
  else if (main.steps) $.ui.status(`main ${String(main.model ?? '?').replace(/^claude-/, '')} · ${main.steps} steps · no subagents yet`)
}

async function resolveJevKey($) {
  if (jevKey) return jevKey
  if (jevKeyReason) return ''
  const envKey = await $.env.get('TYPESAFE_API_KEY')
  if (envKey) {
    jevKey = envKey
    return jevKey
  }
  jevKeyReason = 'no TYPESAFE_API_KEY'
  return ''
}

// Jev covers factory:* by default; AGENT_TREE_JEV=all covers every agent type.
async function resolveJevScope($) {
  if (jevScope) return jevScope
  const raw = await $.env.get('AGENT_TREE_JEV')
  jevScope = String(raw ?? '').trim().toLowerCase() === 'all' ? 'all' : 'factory'
  return jevScope
}

function jevCovers(scope, subagentType) {
  return scope === 'all' || String(subagentType ?? '').startsWith('factory:')
}

async function askJev($, e, key) {
  const init = {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(jevRequest(e)),
  }
  // A hung request must not hold the spawn: race against a short sleep.
  const timeout = $.clock.sleep(JEV_TIMEOUT_MS).then(() => null)
  let res
  try {
    res = await Promise.race([$.http.fetch(JEV_URL, init), timeout])
  } catch (err) {
    return { ok: false, reason: 'fetch failed: ' + String(err?.message ?? err) }
  }
  if (!res) return { ok: false, reason: 'timeout' }
  if (!res.ok) return { ok: false, reason: 'http ' + res.status }
  return jevDecision(res.text)
}

async function allSnapshots($) {
  const keys = (await $.store.keys()).filter((k) => k.startsWith(KEY_PREFIX))
  const out = []
  for (const key of keys) out.push(await $.store.get(key))
  return out
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try {
      // A lead (or any agent) asks for the state of its own department.
      await $.tool.register({
        name: 'status',
        description: 'Show the subagents under the caller (type, model, status, tokens). Main sees every agent; a subagent sees its own subtree.',
        inputSchema: { type: 'object', properties: {} },
      })
    } catch {
      // Already registered (reload): keep going.
    }
    await hydrate($)
    try {
      await $.command.register({
        name: 'agent-tree',
        description: 'Monitor subagents: open/close/focus the panes, all [repo] [--running] [--worktree] for the fleet pane, env for placement facts, list or no args for text',
        argumentHint: '[open | close | focus | env | all [repo] | list]',
      })
    } catch {
      // Name taken: the view is still reachable through the store.
    }
    await save($)
    $.clock.every(3000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  // The id changes on /resume, /branch and when coming back from agent view.
  on('classic.SessionStart', { source: ['resume', 'fork', 'clear'] }, async ($, e, next) => {
    session = null
    if (e.source === 'clear') {
      workers = {}
      main = { model: null, tokens: {}, updatedAt: null }
      events = []
      links = []
      endedAt = null
      return next(e)
    }
    await hydrate($)
    if (!Object.keys(workers).length && e.transcript_path) await adoptFromTranscript($, e.transcript_path)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    endedAt = await $.clock.now()
    await save($)
    return next(e)
  })

  on('session.send', async ($, e, next) => {
    const now = await $.clock.now()
    links = [...links, { dir: 'out', to: e.to, agentId: e.agentId ?? null, at: now }].slice(-LINKS_MAX)
    await save($)
    return next(e)
  })

  on('session.receive', async ($, e, next) => {
    const now = await $.clock.now()
    const sender = parseSender(e.text)
    const from = sender.name ?? e.origin?.teammate ?? e.origin?.kind ?? 'unknown'
    links = [...links, { dir: 'in', from, fromAddr: sender.addr, agentId: e.agentId ?? null, at: now }].slice(-LINKS_MAX)
    await save($)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__agent-tree__status' }, async ($, e) => {
    // First line: whether Jev will pick models, so leads know when to choose.
    const key = await resolveJevKey($)
    const scope = key ? await resolveJevScope($) : null
    const jevLine = !key
      ? 'jev: off (' + (jevKeyReason ?? 'no key') + '; pick model yourself)'
      : scope === 'all'
        ? 'jev: on (all agents; Jev picks the model when you leave it unset)'
        : 'jev: on for factory:* (Jev picks the model when you leave it unset; AGENT_TREE_JEV=all covers every agent)'
    return { result: [jevLine, ...formatTree(workers, e.agentId ?? null)].join('\n') }
  })

  // Jev picks the tier when the caller left `model` open. Forks always inherit.
  // Only factory:* agents are sent to Jev unless AGENT_TREE_JEV=all.
  on('agent.spawn', async ($, e, next) => {
    let jev = null
    let input = e
    if (!e.fork && !e.model) {
      const key = await resolveJevKey($)
      if (!key) {
        jev = { ok: false, reason: jevKeyReason }
      } else if (!jevCovers(await resolveJevScope($), e.subagentType)) {
        jev = { ok: false, reason: 'off for ' + (e.subagentType ?? '(no type)') + '; AGENT_TREE_JEV=all enables it' }
      } else {
        jev = await askJev($, e, key)
        if (jev.ok && jev.applied) input = { ...e, model: jev.choice }
      }
    }
    const result = await next(input)
    if (result && result.agentId) {
      const now = await $.clock.now()
      pushEvent({
        at: now,
        kind: 'spawn',
        agentId: result.agentId,
        type: e.subagentType,
        description: e.description,
        note: jev?.ok ? `jev ${jev.choice} ${jevProb(jev).toFixed(2)}${jev.applied ? ' applied' : ' (kept default)'}` : e.parentAgentId ? '← ' + e.parentAgentId.slice(0, 8) : '',
      })
      if (!paneOpened) await openPane($, false)
      workers = {
        ...workers,
        [result.agentId]: {
          type: e.subagentType,
          description: e.description,
          model: result.model,
          requestedModel: e.model ?? null,
          fork: e.fork,
          background: e.background,
          parentAgentId: e.parentAgentId ?? null,
          status: 'running',
          startedAt: now,
          updatedAt: now,
          steps: 0,
          tokens: {},
          jev,
        },
      }
      await save($)
    }
    return result
  })

  // One model request. Usage goes to the worker (e.agentId) or to main.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const now = await $.clock.now()
    if (e.agentId) {
      if (workers[e.agentId]?.type === 'unknown') await resolveUnknown($)
      const prev = workers[e.agentId] ?? {
        ...(await describeAgent($, e.agentId)),
        model: null,
        status: 'running',
        startedAt: now,
        steps: 0,
        tokens: {},
        jev: null,
      }
      if (prev.status === 'done') {
        // A subagent that finished a turn and got more work: back to running.
        pushEvent({ at: now, kind: 'resume', agentId: e.agentId, type: prev.type, description: prev.description, note: '' })
      }
      workers = {
        ...workers,
        [e.agentId]: {
          ...prev,
          status: prev.status === 'done' ? 'running' : prev.status,
          steps: prev.steps + 1,
          updatedAt: now,
          model: result.usage?.model ?? prev.model,
          tokens: addUsage(prev.tokens, result.usage),
        },
      }
    } else {
      main = { model: result.usage?.model ?? e.model, effort: e.effort ?? main.effort ?? null, steps: (main.steps ?? 0) + 1, tokens: addUsage(main.tokens, result.usage), updatedAt: now }
    }
    await save($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId && workers[e.agentId]) {
      const now = await $.clock.now()
      const w = workers[e.agentId]
      pushEvent({ at: now, kind: e.isAborted ? 'abort' : 'done', agentId: e.agentId, type: w.type, description: w.description, note: `${w.steps} steps` })
      workers = {
        ...workers,
        [e.agentId]: {
          ...workers[e.agentId],
          status: e.isAborted ? 'aborted' : 'done',
          durationMs: e.durationMs,
          summary: String(e.answer ?? '').slice(0, 400),
          updatedAt: now,
        },
      }
      await save($)
    }
    return next(e)
  })

  // One hook for both panes: the same matcher may be registered only once.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId === PANE) {
      const now = await $.clock.now()
      const redraw = () => $.ui.invalidate('ui.render')
      const actions = {
        close: () => $.ui.close({ id: PANE }),
        toggleMode: () => {
          paneMode = paneMode === 'graph' ? 'cards' : 'graph'
          redraw()
        },
        scroll: (delta, win) => {
          paneOffset = Math.max(0, Math.min(win.maxOffset, win.offset + delta))
          redraw()
        },
        select: (id) => {
          if (id === DETAILS_PREV) detailsPage = Math.max(0, detailsPage - 1)
          else if (id === DETAILS_NEXT) detailsPage += 1
          else selectedAgent = id
          redraw()
        },
      }
      // With nothing recorded yet (a resumed or forked session gets a new id),
      // point at the newest other session in the same directory.
      let previous = null
      if (!Object.keys(workers).length) {
        const s = await ensureSession($)
        previous = (await allSnapshots($))
          .filter((x) => x && x.id !== s.id && x.cwd === s.cwd && Object.keys(x.workers ?? {}).length)
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null
      }
      return paneTree(
        $.ui.resolve(e),
        { session, main, workers, events, now, columns: e.props?.bodyColumns ?? 80, mode: paneMode, xOffset: paneOffset, selected: selectedAgent, detailsPage, previous },
        actions,
      )
    }
    if (e.requestId !== FLEET) return next(e)
    const now = await $.clock.now()
    const snapshots = await allSnapshots($)
    const s = await ensureSession($)
    const redraw = () => $.ui.invalidate('ui.render')
    const actions = {
      setRepo: (name) => {
        fleetFilterState = { ...fleetFilterState, repo: name }
        redraw()
      },
      toggle: (key) => {
        fleetFilterState = { ...fleetFilterState, [key]: !fleetFilterState[key] }
        redraw()
      },
      close: () => $.ui.close({ id: FLEET }),
    }
    return fleetTree($.ui.resolve(e), { snapshots, filter: fleetFilterState, currentRoot: s.repo?.root ?? s.cwd, now, columns: e.props?.bodyColumns ?? 80 }, actions)
  })

  on('command.run', { command: 'agent-tree' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'open') {
      await openPane($, true)
      return {}
    }
    if (args === 'close') {
      await $.ui.close({ id: PANE })
      await $.ui.close({ id: FLEET })
      return {}
    }
    if (args === 'focus') {
      // Give the keyboard to the shown pane without the ctrl+x chord.
      const panes = await $.ui.panes()
      const target = panes.find((x) => x.isShown) ?? panes[0]
      if (!target) return { text: 'no pane is open (use open or all)' }
      await $.ui.open({ id: target.id, title: target.title, focus: true, closeOnEscape: true, columns: 100 })
      return {}
    }
    if (args === 'env') {
      // What the engine decided for this session: the facts behind dock/inline.
      const surfaces = await $.session.surfaces()
      const panes = await $.ui.panes()
      const pres = e.presentation ?? {}
      const docked = pres.isFullscreen && pres.columns >= 110
      const lines = [
        `surfaces: ${surfaces.join(', ') || 'none'}`,
        `terminal: ${pres.columns ?? '?'} columns · fullscreen=${pres.isFullscreen ?? 'unknown'} → a pane goes ${docked ? 'beside the transcript (right)' : 'above the prompt'}` +
          (docked ? '' : pres.isFullscreen ? ' (needs 110 columns)' : ' (needs fullscreen rendering)'),
      ]
      for (const x of panes) lines.push(`pane ${x.id}: shown=${x.isShown} focused=${x.isFocused} placed=${x.isPlaced}`)
      if (!panes.length) lines.push('no pane open')
      return { text: lines.join('\n') }
    }
    if (args === 'list') {
      const snapshots = await allSnapshots($)
      if (!snapshots.length) return { text: 'no sessions in the store yet' }
      return { text: formatAll(snapshots).join('\n') }
    }
    if (args === 'all' || args.startsWith('all ')) {
      const words = args.split(/\s+/).slice(1)
      fleetFilterState = {
        repo: words.find((w) => !w.startsWith('--')) ?? '',
        running: words.includes('--running'),
        worktree: words.includes('--worktree'),
      }
      await $.ui.open({ id: FLEET, title: 'fleet', focus: true, closeOnEscape: true, rows: 36, columns: 100 })
      return {}
    }
    if (args) return { text: 'unknown argument: ' + args + ' (use open, close, all [repo] [--running] [--worktree], or list)' }
    const s = await ensureSession($)
    const now = await $.clock.now()
    return { text: formatSnapshot({ ...s, updatedAt: now, endedAt, main, workers, links }).join('\n') }
  })
}
