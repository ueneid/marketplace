// Pure helpers. No mods API (`$`) in this file: static validation only lets
// `$` reach top-level functions of register.js itself.

export const MODEL_TIERS = ['haiku', 'sonnet', 'opus']
export const JEV_THRESHOLD = 0.5
export const PROMPT_LIMIT = 8000

export function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

// Adds one request's usage (TurnUsage) to a per-model token table.
export function addUsage(byModel, usage) {
  if (!usage || !usage.model) return byModel
  const prev = byModel[usage.model] ?? emptyTokens()
  const next = {
    input: prev.input + (usage.input_tokens ?? 0),
    output: prev.output + (usage.output_tokens ?? 0),
    cacheRead: prev.cacheRead + (usage.cache_read_input_tokens ?? 0),
    cacheWrite: prev.cacheWrite + (usage.cache_creation_input_tokens ?? 0),
  }
  return { ...byModel, [usage.model]: next }
}

// The TypeSafe request that asks Jev which model tier a delegated task needs.
export function jevRequest(e) {
  const prompt = e.prompt.length > PROMPT_LIMIT ? e.prompt.slice(0, PROMPT_LIMIT) + '…' : e.prompt
  return {
    model: 'jev-latest',
    state: { subagent_type: e.subagentType, description: e.description, prompt },
    questions: {
      tier: {
        type: 'choice',
        instructions:
          'Which model tier does this delegated coding task need? Judge by how much reasoning and ambiguity the task holds, not by its length.',
        criteria: {
          haiku: 'Mechanical and fully specified: rename, look something up, run a command, copy a known pattern.',
          sonnet: 'Routine engineering: search code, implement a described change, write or run tests, read docs.',
          opus: 'Ambiguous or cross-cutting: unknown root cause, design trade-offs, many files to reconcile, high cost if wrong.',
        },
      },
    },
  }
}

// Turns Jev's response text into a decision. `applied` is true only when the
// answer is a known tier and confidence clears the threshold.
export function jevDecision(text, threshold = JEV_THRESHOLD) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'unparseable response' }
  }
  const answer = parsed?.answers?.tier
  if (!answer || typeof answer.choice !== 'string') return { ok: false, reason: 'no tier answer' }
  const confidence = Number(answer.confidence ?? 0)
  const probabilities = answer.probabilities ?? {}
  // Apply the top choice when its own probability clears the threshold. The
  // distribution's confidence is kept for display but no longer gates.
  const prob = Number(probabilities[answer.choice] ?? confidence)
  const applied = MODEL_TIERS.includes(answer.choice) && prob >= threshold
  return {
    ok: true,
    choice: answer.choice,
    prob,
    confidence,
    probabilities,
    applied,
    reason: applied ? 'likely' : 'below threshold',
  }
}

function short(id) {
  return typeof id === 'string' ? id.slice(0, 8) : '-'
}

function tokenLine(byModel) {
  const parts = Object.entries(byModel ?? {}).map(
    ([model, t]) => `${model} in=${t.input} out=${t.output} cache=${t.cacheRead}/${t.cacheWrite}`,
  )
  return parts.length ? parts.join('; ') : 'no requests yet'
}

// One session's snapshot as plain text lines (the pre-UI view).
export function formatSnapshot(s) {
  if (!s) return ['(no snapshot)']
  const repoName = s.repo?.name ?? (s.repo?.root ? s.repo.root.split('/').filter(Boolean).pop() : null)
  const repo = repoName ? ` repo=${repoName}` : ''
  const ended = s.endedAt ? ' [ended]' : ''
  const lines = [`session ${short(s.id)}${repo} cwd=${s.cwd}${ended}`, `  main: ${tokenLine(s.main?.tokens)}`]
  const tree = formatTree(s.workers, null)
  if (tree.length === 1) lines.push('  workers: none')
  else for (const row of tree.slice(1)) lines.push('  ' + row)
  return lines
}

function workerLine(id, w) {
  const jev = w.jev?.ok
    ? ` jev=${w.jev.choice}(${jevProb(w.jev).toFixed(2)}${w.jev.applied ? ',applied' : ''})`
    : w.jev
      ? ` jev=skipped(${w.jev.reason})`
      : ''
  return `${short(id)} ${w.type} ${w.model ?? '?'} ${w.status} steps=${w.steps}${jev} | ${w.description ?? ''} | ${tokenLine(w.tokens)}`
}

// The agents under `rootId` (null = main) as indented lines. The first line
// names the root; children follow, two spaces deeper per level.
export function formatTree(workers, rootId) {
  const all = Object.entries(workers ?? {})
  const childrenOf = (parent) => all.filter(([, w]) => (w.parentAgentId ?? null) === parent)
  const lines = [rootId ? `${short(rootId)} (you)` : 'main']
  const walk = (parent, depth) => {
    for (const [id, w] of childrenOf(parent)) {
      lines.push('  '.repeat(depth) + workerLine(id, w))
      walk(id, depth + 1)
    }
  }
  walk(rootId, 1)
  if (lines.length === 1) lines.push('(no subagents)')
  return lines
}

function sumTokens(byModel) {
  let n = 0
  for (const t of Object.values(byModel ?? {})) n += t.input + t.output
  return n
}

function k(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}

// The one-line monitor shown under the prompt; empty string when no workers.
export function statusLine(workers) {
  const rows = Object.values(workers ?? {})
  if (!rows.length) return ''
  const running = rows.filter((w) => w.status === 'running').length
  const entries = Object.entries(workers)
  const parts = entries
    .filter(([, w]) => !w.parentAgentId)
    .map(([id, w]) => {
      const type = String(w.type ?? '?').replace(/^[^:\s]+:/, '')
      const model = String(w.model ?? '?').replace(/^claude-/, '')
      const mark = w.status === 'running' ? '…' : w.status === 'done' ? '✓' : '✗'
      const jev = w.jev?.ok && w.jev.applied ? '*' : ''
      const kids = entries.filter(([, c]) => c.parentAgentId === id)
      const dept = kids.length ? ` [${kids.filter(([, c]) => c.status === 'done').length}/${kids.length} done]` : ''
      return `${type}${jev} ${model} ${k(sumTokens(w.tokens))}${mark}${dept}`
    })
  return `${running} running / ${rows.length} total · ${parts.join(' · ')}`
}

function repoKey(s) {
  return s.repo?.remote ?? s.repo?.root ?? '(no repo)'
}

// Orca ids are long (uuid, or "uuid::path"): show the uuid's head and the path's tail.
export function orcaLabel(orca) {
  if (!orca?.workspace) return ''
  const ws = String(orca.workspace).slice(0, 8)
  const wt = orca.worktree ? String(orca.worktree).split('::').pop().split('/').filter(Boolean).pop() : ''
  return ws + (wt ? '/' + wt : '')
}

function sessionLine(s) {
  const orca = s.orca?.workspace ? ` orca=${orcaLabel(s.orca)}` : ''
  const ended = s.endedAt ? ' [ended]' : ''
  const out = (s.links ?? []).filter((x) => x.dir === 'out').map((x) => x.to)
  const inn = (s.links ?? []).filter((x) => x.dir === 'in').map((x) => x.from)
  const linkText = out.length || inn.length ? ` links: ${[...new Set(out)].map((t) => '→' + short(t)).concat([...new Set(inn)].map((f) => '←' + f)).join(' ')}` : ''
  return `session ${short(s.id)} cwd=${s.cwd}${orca}${ended}${linkText}`
}

// Every stored session as repo → worktree → session → agents, newest first.
export function formatAll(snapshots) {
  const byRepo = new Map()
  for (const s of snapshots) {
    if (!s) continue
    const key = repoKey(s)
    if (!byRepo.has(key)) byRepo.set(key, new Map())
    const root = s.repo?.root ?? s.cwd
    const byRoot = byRepo.get(key)
    if (!byRoot.has(root)) byRoot.set(root, [])
    byRoot.get(root).push(s)
  }
  const lines = []
  for (const [key, byRoot] of byRepo) {
    lines.push(`repo ${key}`)
    for (const [root, sessions] of byRoot) {
      lines.push(`  worktree ${root}`)
      sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      for (const s of sessions) {
        lines.push('    ' + sessionLine(s))
        for (const row of formatTree(s.workers, null).slice(1)) lines.push('      ' + row)
      }
    }
  }
  return lines
}

function bar(n, max, width) {
  const filled = max > 0 ? Math.round((n / max) * width) : 0
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

function clock(ms) {
  const d = new Date(ms)
  const two = (x) => String(x).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

function statusMark(status) {
  return status === 'running' ? ['…', 'yellow'] : status === 'done' ? ['✓', 'green'] : ['✗', 'red']
}

function shortModel(model) {
  return String(model ?? '?').replace(/^claude-/, '')
}

function shortType(type) {
  return String(type ?? '?').replace(/^[^:\s]+:/, '')
}

// The graphical monitor: header, one box per top-level agent (its workers
// listed inside), and the recent event log. `ui` is $.ui.resolve(e).
export function paneTree(ui, view, actions = {}) {
  const { Box, Text, Button, Select } = ui
  const { session, main, workers, events, now } = view
  const entries = Object.entries(workers ?? {})
  const maxTokens = Math.max(1, ...entries.map(([, w]) => sumTokens(w.tokens)), sumTokens(main?.tokens))
  const running = entries.filter(([, w]) => w.status === 'running').length
  const done = entries.filter(([, w]) => w.status === 'done').length
  const repo = session?.repo?.name ?? (session?.repo?.root ? session.repo.root.split('/').filter(Boolean).pop() : null)

  const header = Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Text({
            children: [
              Text({ bold: true, children: ['session ' + short(session?.id)] }),
              Text({ dimColor: true, children: [repo ? ' · ' + repo : ''] }),
              Text({ color: 'magenta', children: [' · main ' + shortModel(main?.model)] }),
              Text({ dimColor: true, children: [' · ' + clock(now)] }),
            ],
          }),
          Button({ key: 'close', label: 'close', hotkey: 'q', plain: true, dimColor: true, onPress: () => actions.close && actions.close() }),
          Button({ key: 'mode', label: view.mode === 'cards' ? 'graph' : 'cards', hotkey: 'g', plain: true, dimColor: true, onPress: () => actions.toggleMode && actions.toggleMode() }),
        ],
      }),
      Text({
        children: [
          Text({ children: ['main  '] }),
          Text({ color: 'magenta', children: [bar(sumTokens(main?.tokens), maxTokens, 20)] }),
          Text({ dimColor: true, children: [' ' + tokenLine(main?.tokens)] }),
        ],
      }),
    ],
  })

  const card = (id, w) => {
    const [mark, markColor] = statusMark(w.status)
    const kids = entries.filter(([, c]) => c.parentAgentId === id)
    const jev = w.jev?.ok
      ? Text({ color: w.jev.applied ? 'magenta' : undefined, dimColor: !w.jev.applied, children: [` jev ${w.jev.choice} ${jevProb(w.jev).toFixed(2)}${w.jev.applied ? ' ★' : ''}`] })
      : Text({ dimColor: true, children: [w.jev ? ' jev skipped' : ''] })
    return Box({
      key: 'card-' + id,
      flexDirection: 'column',
      borderStyle: 'round',
      borderDimColor: true,
      paddingX: 1,
      width: 36,
      children: [
        Text({
          wrap: 'truncate-end',
          children: [
            Text({ color: 'cyan', bold: true, children: [shortType(w.type)] }),
            Text({ dimColor: true, children: [' · ' + String(w.description ?? '').slice(0, 18)] }),
            Text({ color: markColor, children: [' ' + mark + ' ' + w.status] }),
          ],
        }),
        Text({ children: [Text({ children: [shortModel(w.model)] }), jev] }),
        Text({
          children: [
            Text({ color: 'cyan', children: [bar(sumTokens(w.tokens), maxTokens, 14)] }),
            Text({ dimColor: true, children: [' ' + k(sumTokens(w.tokens)) + ' · ' + w.steps + ' steps'] }),
          ],
        }),
        ...kids.map(([cid, c], i) => {
          const [cm, cc] = statusMark(c.status)
          return Text({
            wrap: 'truncate-end',
            children: [
              Text({ dimColor: true, children: [(i === kids.length - 1 ? ' └ ' : ' ├ ') + shortType(c.type) + ' ' + String(c.description ?? '').slice(0, 14) + ' '] }),
              Text({ color: cc, children: [cm] }),
              Text({ dimColor: true, children: [' ' + k(sumTokens(c.tokens))] }),
            ],
          })
        }),
      ],
    })
  }

  const columns = view.columns ?? 80
  const win = view.mode === 'cards' || !entries.length ? null : graphWindow(view, columns, view.xOffset ?? null)
  const hint = win && win.maxOffset > 0 ? `   cols ${win.offset + 1}–${win.offset + columns} of ${win.width}` : ''
  const departments = Box({
    flexDirection: 'column',
    children: [
      Text({
        children: [
          Text({ bold: true, children: ['departments'] }),
          Text({ dimColor: true, children: ['   '] }),
          Text({ color: 'green', children: [done + ' done'] }),
          Text({ dimColor: true, children: [' · '] }),
          Text({ color: 'yellow', children: [running + ' running'] }),
          Text({ dimColor: true, children: [' · ' + entries.length + ' agents' + hint] }),
        ],
      }),
      entries.length
        ? Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, children: entries.filter(([, w]) => !w.parentAgentId).map(([id, w]) => card(id, w)) })
        : Text({
            dimColor: true,
            children: [
              'no subagents yet' +
                (view.previous ? ` · this session's id is new; the last session here (${short(view.previous.id)}, ${Object.keys(view.previous.workers ?? {}).length} agents) is in /agent-tree all` : ''),
            ],
          }),
    ],
  })

  const log = Box({
    flexDirection: 'column',
    children: [
      Text({ bold: true, children: ['log'] }),
      ...(events ?? []).slice(-8).map((ev, i) =>
        Text({
          key: 'ev-' + i,
          wrap: 'truncate-end',
          children: [
            Text({ dimColor: true, children: [clock(ev.at) + ' '] }),
            Text({ color: ev.kind === 'spawn' ? 'cyan' : ev.kind === 'done' ? 'green' : ev.kind === 'resume' ? 'yellow' : 'red', children: [ev.kind.padEnd(6)] }),
            Text({ children: [' ' + shortType(ev.type) + ' ' + String(ev.description ?? '').slice(0, 24)] }),
            Text({ dimColor: true, children: [ev.note ? '   ' + ev.note : ''] }),
          ],
        }),
      ),
      ...((events ?? []).length ? [] : [Text({ dimColor: true, children: ['nothing yet'] })]),
    ],
  })

  const scrollButtons =
    win && win.maxOffset > 0
      ? [
          Text({ dimColor: true, children: ['  '] }),
          Button({ key: 'left', label: '◀', hotkey: 'h', plain: true, dimColor: win.offset === 0, onPress: () => actions.scroll && actions.scroll(-Math.floor(columns / 2), win) }),
          Button({ key: 'right', label: '▶', hotkey: 'l', plain: true, dimColor: win.offset >= win.maxOffset, onPress: () => actions.scroll && actions.scroll(Math.floor(columns / 2), win) }),
          Text({ dimColor: true, children: [hint] }),
        ]
      : []
  const middle = win
    ? Box({
        flexDirection: 'column',
        children: [
          Box({
            flexDirection: 'row',
            children: [
              Text({
                children: [
                  Text({ bold: true, children: ['agents'] }),
                  Text({ dimColor: true, children: ['   '] }),
                  Text({ color: 'green', children: [done + ' done'] }),
                  Text({ dimColor: true, children: [' · '] }),
                  Text({ color: 'yellow', children: [running + ' running'] }),
                  Text({ dimColor: true, children: [' · ' + entries.length + ' agents'] }),
                ],
              }),
              ...scrollButtons,
            ],
          }),
          ...graphTexts(ui, win.rows),
        ],
      })
    : departments

  // details: pick an agent to read its summary
  const selected = view.selected && workers?.[view.selected] ? workers[view.selected] : null
  const picker = detailsOptions(entries, view.detailsPage ?? 0)
  const details = Box({
    flexDirection: 'column',
    children: [
      Select({
        key: 'details',
        label: picker.pages > 1 ? `details (page ${picker.page + 1}/${picker.pages})` : 'details',
        options: picker.options,
        value: picker.options.some((o) => o.value === view.selected) && selected ? view.selected : '',
        onSelect: (value) => actions.select && actions.select(value),
      }),
      ...(selected
        ? [
            Text({ wrap: 'wrap', children: [Text({ bold: true, color: 'cyan', children: [shortType(selected.type)] }), Text({ children: [' · ' + (selected.description ?? '')] })] }),
            Text({ dimColor: true, wrap: 'wrap', children: [`model ${selected.model ?? '?'} · ${selected.status} · ${selected.steps} steps${selected.durationMs ? ' · ' + (selected.durationMs / 1000).toFixed(0) + 's' : ''} · ${tokenLine(selected.tokens)}`] }),
            Text({ dimColor: true, wrap: 'wrap', children: [selected.jev?.ok ? `jev ${selected.jev.choice} ${jevProb(selected.jev).toFixed(2)}${selected.jev.applied ? ' ★ applied' : ' (kept default)'} · ${jevProbsText(selected.jev)}` : selected.jev ? 'jev skipped: ' + selected.jev.reason : 'jev: not asked'] }),
            Text({ wrap: 'wrap', children: [selected.summary ? selected.summary : '(no report yet)'] }),
          ]
        : []),
    ],
  })
  return Box({ flexDirection: 'column', rowGap: 1, children: [header, middle, details, log] })
}

// A Select may hold at most 64 options (the engine refuses the whole pane past
// that), so the details picker shows one page of agents at a time: `(none)`,
// an `… earlier` / `… later` entry where there is a page that way, and the page.
export const DETAILS_PAGE = 60
export const DETAILS_PREV = 'page:prev'
export const DETAILS_NEXT = 'page:next'

export function detailsOptions(entries, page) {
  const n = entries.length
  const pages = Math.max(1, Math.ceil(n / DETAILS_PAGE))
  const p = Math.max(0, Math.min(pages - 1, page ?? 0))
  const from = p * DETAILS_PAGE
  const to = Math.min(n, from + DETAILS_PAGE)
  const options = [{ value: '', label: '(none)' }]
  if (p > 0) options.push({ value: DETAILS_PREV, label: `… earlier (${from} agents)` })
  for (const [id, w] of entries.slice(from, to)) {
    const mark = w.status === 'running' ? '…' : w.status === 'done' ? '✓' : '✗'
    options.push({ value: id, label: `${shortType(w.type)} · ${String(w.description ?? '').slice(0, 40)} ${mark}` })
  }
  if (p < pages - 1) options.push({ value: DETAILS_NEXT, label: `… later (${n - to} agents)` })
  return { options, page: p, pages }
}

// ---- graph: a text canvas with box-drawing connectors ----------------------

function makeCanvas(width, height) {
  const rows = []
  for (let y = 0; y < height; y++) rows.push(Array.from({ length: width }, () => ({ ch: ' ', style: '' })))
  return rows
}

function put(canvas, x, y, text, style = '') {
  const row = canvas[y]
  if (!row) return
  let i = 0
  for (const ch of String(text)) {
    const cell = row[x + i]
    if (cell) {
      cell.ch = ch
      cell.style = style
    }
    i += 1
  }
}

function fit(text, width) {
  const t = String(text ?? '')
  return t.length > width ? t.slice(0, Math.max(0, width - 1)) + '…' : t
}

// Draws one agent card at (x, y): border, title row, model/jev row, bar row.
function drawCard(canvas, x, y, w, node) {
  const inner = w - 2
  const border = node.isMain ? 'magenta' : 'dim'
  put(canvas, x, y, '┌' + '─'.repeat(inner) + '┐', border)
  for (let r = 1; r <= 3; r++) {
    put(canvas, x, y + r, '│', border)
    put(canvas, x + w - 1, y + r, '│', border)
  }
  put(canvas, x, y + 4, '└' + '─'.repeat(inner) + '┘', border)

  if (node.isMain) {
    put(canvas, x + 1, y + 1, fit(' main · ' + short(node.sessionId), inner), 'boldmagenta')
    put(canvas, x + 1, y + 2, fit(' ' + shortModel(node.model) + (node.effort ? ' · ' + node.effort : ''), inner), '')
  } else {
    const [mark, color] = statusMark(node.status)
    const title = ' ' + shortType(node.type)
    put(canvas, x + 1, y + 1, fit(title, inner), 'boldcyan')
    put(canvas, x + 1 + title.length, y + 1, fit(' · ' + (node.description ?? ''), inner - title.length - 3), 'dim')
    put(canvas, x + w - 3, y + 1, mark, color)
    const model = ' ' + shortModel(node.model)
    put(canvas, x + 1, y + 2, fit(model, inner), '')
    if (node.jev?.ok) {
      const txt = ` jev ${node.jev.choice} ${jevProb(node.jev).toFixed(2)}${node.jev.applied ? ' ★' : ''}`
      put(canvas, x + 1 + model.length, y + 2, fit(txt, inner - model.length), node.jev.applied ? 'magenta' : 'dim')
    }
  }
  const barW = Math.max(3, Math.min(12, inner - 14))
  put(canvas, x + 2, y + 3, bar(node.tokens, node.maxTokens, barW), node.isMain ? 'magenta' : 'cyan')
  put(canvas, x + 2 + barW, y + 3, fit(' ' + k(node.tokens) + ' · ' + (node.steps ?? 0) + 'st', inner - barW - 1), 'dim')
}

// Builds the node tree (main → top-level agents → their children) from a snapshot.
function graphNodes(view) {
  const entries = Object.entries(view.workers ?? {})
  const maxTokens = Math.max(1, ...entries.map(([, w]) => sumTokens(w.tokens)), sumTokens(view.main?.tokens))
  const mk = (id, w) => ({
    id,
    type: w.type,
    description: w.description,
    status: w.status,
    model: w.model,
    jev: w.jev,
    tokens: sumTokens(w.tokens),
    steps: w.steps,
    maxTokens,
    children: entries.filter(([, c]) => c.parentAgentId === id).map(([cid, c]) => mk(cid, c)),
  })
  return {
    id: 'main',
    isMain: true,
    sessionId: view.session?.id,
    model: view.main?.model,
    effort: view.main?.effort,
    tokens: sumTokens(view.main?.tokens),
    steps: view.main?.steps,
    maxTokens,
    children: entries.filter(([, w]) => !w.parentAgentId).map(([id, w]) => mk(id, w)),
  }
}

// Classic tree layout: a node is centred over its children; siblings sit side
// by side. Returns the subtree width and sets node.x (column) and node.depth.
function layout(node, x, depth, cardW, gap) {
  node.depth = depth
  if (!node.children.length) {
    node.x = x
    return cardW
  }
  let cursor = x
  for (const child of node.children) {
    cursor += layout(child, cursor, depth + 1, cardW, gap) + gap
  }
  const span = cursor - gap - x
  node.x = x + Math.max(0, Math.floor((span - cardW) / 2))
  return Math.max(cardW, span)
}

function collect(node, out = []) {
  out.push(node)
  for (const c of node.children) collect(c, out)
  return out
}

const CARD_H = 5
const LINK_H = 3

// Renders the whole graph as rows of styled segments, or null when even the
// narrowest cards do not fit in `columns`.
export const GRAPH_MIN_CARD = 14

// The narrowest width the graph can be drawn in for this view.
export function graphMinWidth(view) {
  return layout(graphNodes(view), 0, 0, GRAPH_MIN_CARD, 2)
}

// Lays out and draws the graph. With `allowOverflow` false, null when even the
// narrowest cards do not fit in `columns`; otherwise the canvas may be wider.
function renderCanvas(view, columns, allowOverflow) {
  const root = graphNodes(view)
  let cardW = 28
  let width = 0
  for (;;) {
    width = layout(root, 0, 0, cardW, 2)
    if (width <= columns || cardW <= GRAPH_MIN_CARD) break
    cardW -= 2
  }
  if (width > columns && !allowOverflow) return null
  const nodes = collect(root)
  const depth = Math.max(...nodes.map((n) => n.depth))
  const height = (depth + 1) * CARD_H + depth * LINK_H
  const canvas = makeCanvas(width, height)
  const yOf = (d) => d * (CARD_H + LINK_H)
  const centre = (n) => n.x + Math.floor(cardW / 2)

  for (const n of nodes) {
    drawCard(canvas, n.x, yOf(n.depth), cardW, n)
    if (!n.children.length) continue
    const y = yOf(n.depth) + CARD_H
    const pc = centre(n)
    const cs = n.children.map(centre)
    const left = Math.min(...cs, pc)
    const right = Math.max(...cs, pc)
    put(canvas, pc, y - 1, '┬', 'dim')
    put(canvas, pc, y, '│', 'dim')
    for (let x = left; x <= right; x++) put(canvas, x, y + 1, '─', 'dim')
    for (const c of cs) put(canvas, c, y + 1, c === left ? '┌' : c === right ? '┐' : '┬', 'dim')
    if (cs.length === 1 && cs[0] === pc) put(canvas, pc, y + 1, '│', 'dim')
    else put(canvas, pc, y + 1, cs.includes(pc) ? '┼' : pc === left ? '├' : pc === right ? '┤' : '┴', 'dim')
    for (const c of cs) put(canvas, c, y + 2, '▼', 'cyan')
  }
  return { canvas, width, mainCentre: centre(root) }
}

// Rows of styled segments for the columns [from, to) of a canvas.
function canvasRows(canvas, from, to) {
  return canvas.map((row) => {
    const segs = []
    for (const cell of row.slice(from, to)) {
      const last = segs[segs.length - 1]
      if (last && last.style === cell.style) last.text += cell.ch
      else segs.push({ text: cell.ch, style: cell.style })
    }
    return segs
  })
}

// The whole graph when it fits in `columns`, else null (the fleet view falls
// back to an indented list).
export function graphRows(view, columns) {
  const r = renderCanvas(view, columns, false)
  return r ? canvasRows(r.canvas, 0, r.width) : null
}

// Always draws: a `columns`-wide window onto the graph, scrolled to `offset`
// (null centres on main). Returns the rows and the window's position.
export function graphWindow(view, columns, offset) {
  const r = renderCanvas(view, columns, true)
  const maxOffset = Math.max(0, r.width - columns)
  let x = offset == null ? Math.round(r.mainCentre - columns / 2) : offset
  x = Math.max(0, Math.min(maxOffset, x))
  return { rows: canvasRows(r.canvas, x, x + columns), width: r.width, offset: x, maxOffset, columns }
}

function styleProps(style) {
  switch (style) {
    case 'dim':
      return { dimColor: true }
    case 'bold':
      return { bold: true }
    case 'boldcyan':
      return { bold: true, color: 'cyan' }
    case 'boldmagenta':
      return { bold: true, color: 'magenta' }
    case '':
      return {}
    default:
      return { color: style }
  }
}

// Turns graph rows into Text elements (one per line).
export function graphTexts(ui, rows) {
  const { Text } = ui
  return rows.map((segs, i) =>
    Text({
      key: 'g-' + i,
      wrap: 'truncate-end',
      children: segs.map((s) => Text({ ...styleProps(s.style), children: [s.text] })),
    }),
  )
}

// ---- fleet: every stored session, grouped, with filter tabs -----------------

export function repoLabel(s) {
  const key = repoKey(s)
  return key === '(no repo)' ? key : key.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop()
}

// Applies the tab/toggle filter to a list of snapshots.
export function fleetFilter(snapshots, filter, currentRoot) {
  return (snapshots ?? []).filter((s) => {
    if (!s) return false
    if (filter.repo && repoLabel(s) !== filter.repo) return false
    if (filter.running && !Object.values(s.workers ?? {}).some((w) => w.status === 'running')) return false
    if (filter.worktree && (s.repo?.root ?? s.cwd) !== currentRoot) return false
    return true
  })
}

function fleetTotals(snapshots) {
  const byModel = {}
  let running = 0
  let agents = 0
  for (const s of snapshots) {
    for (const [m, t] of Object.entries(s.main?.tokens ?? {})) byModel[m] = (byModel[m] ?? 0) + t.input + t.output
    for (const w of Object.values(s.workers ?? {})) {
      agents += 1
      if (w.status === 'running') running += 1
      for (const [m, t] of Object.entries(w.tokens ?? {})) byModel[m] = (byModel[m] ?? 0) + t.input + t.output
    }
  }
  return { byModel, running, agents }
}

// The fleet pane: tabs, totals, then repo → worktree → session → graph.
// `actions` are plain callbacks from register.js (setRepo, toggle, redraw).
export function fleetTree(ui, view, actions) {
  const { Box, Text, Button } = ui
  const { snapshots, filter, currentRoot, now, columns } = view
  const all = (snapshots ?? []).filter(Boolean)
  const labels = [...new Set(all.map(repoLabel))].sort()
  const shown = fleetFilter(all, filter, currentRoot)
  const totals = fleetTotals(shown)

  const tab = (key, label, hotkey, on, onPress) =>
    Button({ key, label: (on ? '[' : ' ') + label + (on ? ']' : ' '), hotkey, plain: true, dimColor: !on, onPress })
  const tabs = Box({
    flexDirection: 'row',
    columnGap: 1,
    children: [
      tab('tab-all', 'all', '1', !filter.repo, () => actions.setRepo('')),
      ...labels.slice(0, 8).map((name, i) => tab('tab-' + name, name, String(i + 2), filter.repo === name, () => actions.setRepo(name))),
      Text({ dimColor: true, children: [' '] }),
      tab('tab-running', 'running', 'r', filter.running, () => actions.toggle('running')),
      tab('tab-worktree', 'this worktree', 'w', filter.worktree, () => actions.toggle('worktree')),
      Text({ dimColor: true, children: [' '] }),
      Button({ key: 'close', label: 'close', hotkey: 'q', plain: true, dimColor: true, onPress: () => actions.close && actions.close() }),
    ],
  })

  const repos = new Set(shown.map(repoKey)).size
  const worktrees = new Set(shown.map((s) => s.repo?.root ?? s.cwd)).size
  const summary = Text({
    children: [
      Text({ bold: true, children: ['fleet'] }),
      Text({ dimColor: true, children: [` · ${repos} repos · ${worktrees} worktrees · ${shown.length} sessions · `] }),
      Text({ color: 'yellow', children: [totals.running + ' running'] }),
      Text({ dimColor: true, children: [` · ${totals.agents} agents · ${clock(now)}`] }),
    ],
  })
  const maxTok = Math.max(1, ...Object.values(totals.byModel))
  const bars = Object.entries(totals.byModel)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) =>
      Text({
        key: 'tot-' + m,
        children: [
          Text({ dimColor: true, children: ['  ' + shortModel(m).padEnd(12) + ' '] }),
          Text({ color: m.includes('opus') ? 'magenta' : m.includes('fable') ? 'yellow' : 'cyan', children: [bar(n, maxTok, 24)] }),
          Text({ dimColor: true, children: [' ' + k(n)] }),
        ],
      }),
    )

  const rows = []
  let lastRepo = null
  let lastRoot = null
  const sorted = [...shown].sort((a, b) => repoKey(a).localeCompare(repoKey(b)) || (a.repo?.root ?? a.cwd).localeCompare(b.repo?.root ?? b.cwd) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  for (const s of sorted) {
    const key = repoKey(s)
    const root = s.repo?.root ?? s.cwd
    if (key !== lastRepo) {
      rows.push(Text({ key: 'repo-' + key, bold: true, children: ['repo ' + key] }))
      lastRepo = key
      lastRoot = null
    }
    if (root !== lastRoot) {
      rows.push(Text({ key: 'wt-' + root, children: [Text({ dimColor: true, children: ['  worktree '] }), Text({ children: [root] })] }))
      lastRoot = root
    }
    const bits = [
      s.orca?.workspace ? 'orca=' + orcaLabel(s.orca) : '',
      s.endedAt ? '[ended]' : '',
    ].filter(Boolean)
    const name = sessionName(all, s)
    rows.push(
      Text({
        key: 'sess-' + s.id,
        children: [
          Text({ bold: true, color: 'magenta', children: ['    session ' + short(s.id)] }),
          Text({ color: 'cyan', children: [name ? ' "' + name + '"' : ''] }),
          Text({ dimColor: true, children: ['  ' + bits.join('  ')] }),
        ],
      }),
    )
    const line = statusLine(s.workers)
    if (line) {
      rows.push(Text({ key: 'line-' + s.id, dimColor: true, wrap: 'truncate-end', children: ['    ' + line] }))
      const graph = graphRows({ session: s, main: s.main, workers: s.workers }, Math.max(20, (columns ?? 80) - 6))
      if (graph) {
        rows.push(Box({ key: 'graph-' + s.id, flexDirection: 'column', paddingLeft: 6, children: graphTexts(ui, graph) }))
      } else {
        // Too narrow for boxes: the same tree as indented lines.
        rows.push(
          Box({
            key: 'tree-' + s.id,
            flexDirection: 'column',
            paddingLeft: 6,
            children: formatTree(s.workers, null)
              .slice(1)
              .map((line, i) => Text({ key: 'tree-' + s.id + '-' + i, wrap: 'truncate-end', children: [treeLineText(line)] })),
          }),
        )
      }
    } else {
      // No subagents: one line, no graph. Idle sessions stay out of the way.
      const steps = s.main?.steps ?? 0
      const summary = steps ? `main ${shortModel(s.main?.model)} ${k(sumTokens(s.main?.tokens))} · ${steps} steps · no subagents` : 'idle · no requests yet'
      rows.push(Text({ key: 'line-' + s.id, dimColor: true, wrap: 'truncate-end', children: ['    ' + summary] }))
    }
    rows.push(Text({ key: 'gap-' + s.id, children: [' '] }))
  }
  if (!shown.length) rows.push(Text({ dimColor: true, children: ['no sessions match'] }))

  // Messages between the shown sessions, newest last.
  const shownIds = new Set(shown.map((s) => s.id))
  const edges = sessionEdges(all).filter((e) => shownIds.has(e.from) || (e.to && shownIds.has(e.to)))
  const label = (id) => (id ? short(id) + (sessionName(all, { id }) ? ' "' + sessionName(all, { id }) + '"' : '') : null)
  const messages = edges.length
    ? [
        Text({ bold: true, children: ['messages'] }),
        ...edges.slice(-8).map((e, i) =>
          Text({
            key: 'edge-' + i,
            wrap: 'truncate-end',
            children: [
              Text({ dimColor: true, children: ['  ' + clock(e.at) + ' '] }),
              Text({ color: 'magenta', children: [label(e.from)] }),
              Text({ dimColor: true, children: [' → '] }),
              Text({ color: e.to ? 'magenta' : undefined, dimColor: !e.to, children: [e.to ? label(e.to) : String(e.raw ?? '?') + ' (not a known session)'] }),
            ],
          }),
        ),
        Text({ children: [' '] }),
      ]
    : []

  return Box({ flexDirection: 'column', children: [tabs, Text({ children: [' '] }), summary, ...bars, Text({ children: [' '] }), ...messages, ...rows] })
}

// A formatTree line without its "| description | tokens" tail, for narrow panes.
function treeLineText(line) {
  const head = line.split(' | ')[0]
  return head.replace(/ steps=\d+/, '').replace(/^(\s*)(\S+) (\S+) (\S+) (\S+)/, (m, ind, id, type, model, status) => `${ind}${shortType(type)} ${shortModel(model)} ${status === 'running' ? '…' : status === 'done' ? '✓' : '✗'}`)
}

// ---- cross-session messages ------------------------------------------------

// A received message starts with a <cross-session-message from="uds:…" from-name="…"> tag.
export function parseSender(text) {
  const m = /<cross-session-message\b([^>]*)>/.exec(String(text ?? ''))
  if (!m) return { addr: null, name: null }
  const attr = (k) => {
    const r = new RegExp(k + '="([^"]*)"').exec(m[1])
    return r ? r[1] : null
  }
  return { addr: attr('from'), name: attr('from-name') }
}

// Names and addresses other sessions used for each session, learned from the
// messages they received: { [sessionId]: { name, addr } }.
function sessionIdentities(snapshots) {
  const bySocket = new Map(snapshots.filter((s) => s?.socket).map((s) => [s.socket, s.id]))
  const names = {}
  for (const s of snapshots) {
    for (const link of s.links ?? []) {
      if (link.dir === 'in' && link.fromAddr && bySocket.has(link.fromAddr) && link.from) names[bySocket.get(link.fromAddr)] = link.from
    }
  }
  return { bySocket, names }
}

export function sessionName(snapshots, s) {
  return sessionIdentities(snapshots).names[s.id] ?? null
}

// Directed edges between sessions: each `out` link resolved to a session by
// address, by the name others know it under, or by a matching `in` link within
// 3 seconds. Unresolved targets are kept with `to: null` and the raw address.
export function sessionEdges(snapshots) {
  const all = snapshots.filter(Boolean)
  const { bySocket, names } = sessionIdentities(all)
  const byName = new Map(Object.entries(names).map(([id, name]) => [name, id]))
  const edges = []
  for (const s of all) {
    for (const link of s.links ?? []) {
      if (link.dir !== 'out') continue
      // A message to one of this session's own subagents is not a session edge.
      if (link.to && s.workers && Object.prototype.hasOwnProperty.call(s.workers, link.to)) continue
      let to = bySocket.get(link.to) ?? byName.get(link.to) ?? null
      if (!to) {
        const hit = all.find((o) => o.id !== s.id && (o.links ?? []).some((x) => x.dir === 'in' && Math.abs((x.at ?? 0) - (link.at ?? 0)) <= 3000))
        to = hit ? hit.id : null
      }
      edges.push({ from: s.id, to, raw: link.to, at: link.at })
    }
  }
  return edges.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
}

// The probability Jev gave its top choice (older records only have confidence).
export function jevProb(jev) {
  return Number(jev?.prob ?? jev?.confidence ?? 0)
}

export function jevProbsText(jev) {
  const p = jev?.probabilities ?? {}
  return Object.entries(p)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${Number(v).toFixed(2)}`)
    .join(' · ')
}
