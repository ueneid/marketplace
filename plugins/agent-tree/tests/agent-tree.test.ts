import { expect, mock, test } from 'claude-code/testing'
import { graphRows, graphMinWidth, graphWindow, parseSender, sessionEdges } from '../hooks/lib.js'

const KEY = 'session:sess-1'

function out_prefix_ok(text: string) {
  return text.split('\n')[2].startsWith('    a1 ')
}

function jevReply(choice: string, confidence: number) {
  return JSON.stringify({
    model: 'jev-1.13.0',
    answers: { tier: { type: 'choice', choice, probabilities: { [choice]: confidence, other: Number((1 - confidence).toFixed(2)) }, confidence } },
    usage: { input_tokens: 1, output_tokens: 0 },
  })
}

// Stubs every mod call the hooks make apart from env and http.
function baseStubs(on: any, saved: Map<string, unknown>) {
  mock.clock(on, { now: 1000 })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.repo', () => ({ value: { root: '/work/repo', remote: null, internal: false, name: 'repo' } }))
  on('store.set', ($: any, e: any) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
}

const PANE = {
  plugin: 'agent-tree',
  component: 'Pane',
  requestId: 'agent-tree',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'agent-tree', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

function usage(model: string) {
  return { model, input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 }
}

async function runStep($: any, agentId?: string, effort?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}), ...(effort ? { effort } : {}) } as any)
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

test('turn.step attributes usage to the worker or main and writes the store', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage('claude-sonnet-5') }
  })

  await runStep($, 'a1')
  await runStep($, 'a1')
  await runStep($)

  const snap = saved.get(KEY) as any
  expect(snap.id).toBe('sess-1')
  expect(snap.workers.a1.steps).toBe(2)
  expect(snap.workers.a1.tokens['claude-sonnet-5'].input).toBe(200)
  expect(snap.workers.a1.model).toBe('claude-sonnet-5')
  expect(snap.main.tokens['claude-sonnet-5'].output).toBe(20)
})

test('agent.spawn lets Jev pick the model when it is confident', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
  let fetches = 0
  on('http.fetch', () => {
    fetches += 1
    return { value: { status: 200, ok: true, headers: {}, text: jevReply('opus', 0.91) } }
  })
  let seenModel: string | undefined = 'unset'
  on('agent.spawn', ($: any, e: any) => {
    seenModel = e.model
    return { model: e.model ?? 'claude-sonnet-5', agentId: 'a1' }
  })

  await $.agent.spawn({ prompt: 'Find why the auth tests flake', description: 'debug flaky auth', subagentType: 'factory:worker' })

  expect(fetches).toBe(1)
  expect(seenModel).toBe('opus')
  const snap = saved.get(KEY) as any
  expect(snap.workers.a1.jev.applied).toBe(true)
  expect(snap.workers.a1.model).toBe('opus')
  expect(snap.workers.a1.status).toBe('running')
})

test('agent.spawn leaves the model alone when the top choice is below 0.5', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: jevReply('opus', 0.45) } }))
  let seenModel: string | undefined = 'unset'
  on('agent.spawn', ($: any, e: any) => {
    seenModel = e.model
    return { model: 'claude-sonnet-5', agentId: 'a1' }
  })

  await $.agent.spawn({ prompt: 'rename a variable', description: 'rename', subagentType: 'factory:worker' })

  expect(seenModel).toBeUndefined()
  const snap = saved.get(KEY) as any
  expect(snap.workers.a1.jev.applied).toBe(false)
  expect(snap.workers.a1.jev.choice).toBe('opus')
  expect(snap.workers.a1.jev.prob).toBe(0.45)
})

test('agent.spawn skips Jev without an API key and for forks', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  let fetches = 0
  on('http.fetch', () => {
    fetches += 1
    return { value: { status: 200, ok: true, headers: {}, text: jevReply('haiku', 0.99) } }
  })
  let spawns = 0
  on('agent.spawn', () => {
    spawns += 1
    return { model: 'claude-sonnet-5', agentId: 'a' + spawns }
  })

  await $.agent.spawn({ prompt: 'x', description: 'no key', subagentType: 'worker' })
  await $.agent.spawn({ prompt: 'x', description: 'fork', subagentType: 'fork', fork: true } as any)

  expect(fetches).toBe(0)
  const snap = saved.get(KEY) as any
  expect(snap.workers.a1.jev.reason).toBe('no TYPESAFE_API_KEY')
  expect(snap.workers.a2.jev).toBe(null)
})

test('agent.spawn skips Jev for non-factory agents unless AGENT_TREE_JEV=all', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
  let fetches = 0
  on('http.fetch', () => {
    fetches += 1
    return { value: { status: 200, ok: true, headers: {}, text: jevReply('opus', 0.91) } }
  })
  let n = 0
  const seen: Array<string | undefined> = []
  on('agent.spawn', ($: any, e: any) => {
    seen.push(e.model)
    return { model: e.model ?? 'claude-sonnet-5', agentId: 'a' + ++n }
  })

  await $.agent.spawn({ prompt: 'x', description: 'other plugin', subagentType: 'superpowers:explorer' })
  await $.agent.spawn({ prompt: 'x', description: 'typeless', subagentType: undefined } as any)
  await $.agent.spawn({ prompt: 'x', description: 'factory lead', subagentType: 'factory:lead' })

  expect(fetches).toBe(1)
  expect(seen).toEqual([undefined, undefined, 'opus'])
  const snap = saved.get(KEY) as any
  expect(snap.workers.a1.jev.ok).toBe(false)
  expect(snap.workers.a1.jev.reason).toBe('off for superpowers:explorer; AGENT_TREE_JEV=all enables it')
  expect(snap.workers.a2.jev.reason).toBe('off for (no type); AGENT_TREE_JEV=all enables it')
  expect(snap.workers.a3.jev.applied).toBe(true)
})

test('AGENT_TREE_JEV=all asks Jev for every agent type', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', AGENT_TREE_JEV: 'all' })
  let fetches = 0
  on('http.fetch', () => {
    fetches += 1
    return { value: { status: 200, ok: true, headers: {}, text: jevReply('haiku', 0.9) } }
  })
  let seenModel: string | undefined = 'unset'
  on('agent.spawn', ($: any, e: any) => {
    seenModel = e.model
    return { model: e.model ?? 'claude-sonnet-5', agentId: 'a1' }
  })

  await $.agent.spawn({ prompt: 'x', description: 'other plugin', subagentType: 'superpowers:explorer' })

  expect(fetches).toBe(1)
  expect(seenModel).toBe('haiku')
  const snap = saved.get(KEY) as any
  expect(snap.workers.a1.jev.applied).toBe(true)
})

test('the status tool says which agents Jev covers', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key' })
  const scoped = await $.tool.call({ tool: 'mcp__agent-tree__status' })
  expect(scoped.result.split('\n')[0]).toBe('jev: on for factory:* (Jev picks the model when you leave it unset; AGENT_TREE_JEV=all covers every agent)')
})

test('the status tool says jev: on for all agents under AGENT_TREE_JEV=all', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', AGENT_TREE_JEV: 'all' })
  const all = await $.tool.call({ tool: 'mcp__agent-tree__status' })
  expect(all.result.split('\n')[0]).toBe('jev: on (all agents; Jev picks the model when you leave it unset)')
})

test('turn.step records a worker’s effort and the status tool shows it with its tokens', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'a1' }))
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage('claude-sonnet-5') }
  })

  await $.agent.spawn({ prompt: 'x', description: 'piece', subagentType: 'factory:worker' })
  await runStep($, 'a1', 'high')
  await runStep($, 'a1')

  const snap = saved.get(KEY) as any
  expect(snap.workers.a1.effort).toBe('high')
  const out = await $.tool.call({ tool: 'mcp__agent-tree__status' })
  expect(out.result).toContain('a1 factory:worker claude-sonnet-5 effort=high running steps=2')
  expect(out.result).toContain('claude-sonnet-5 in=200 out=40 cache=10/2')
})

test('turn.complete marks the worker done', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ prompt: 'x', description: 'd', subagentType: 'worker' })
  await $.turn.complete({ turnId: 't', agentId: 'a1', answer: 'done', durationMs: 1234, isAborted: false, reason: 'answer', usage: usage('claude-sonnet-5') } as any)

  const snap = saved.get(KEY) as any
  expect(snap.workers.a1.status).toBe('done')
  expect(snap.workers.a1.durationMs).toBe(1234)
})

test('/agent-tree prints this session and "list" prints every stored session', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:other', { id: 'other-session', cwd: '/elsewhere', repo: { name: 'other' }, main: { tokens: {} }, workers: {} })
  baseStubs(on, saved)
  mock.env(on, {})
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage('claude-sonnet-5') }
  })
  await runStep($, 'a1')

  const mine = await $.command.run({ command: 'agent-tree', args: '' })
  expect(mine.text).toMatch(/^session sess-1 repo=repo cwd=\/work\/repo/)
  expect(mine.text).toContain('a1 unknown claude-sonnet-5 running steps=1')
  expect(out_prefix_ok(mine.text)).toBe(true)
  expect(mine.text).toContain('a1 unknown')

  const all = await $.command.run({ command: 'agent-tree', args: 'list' })
  expect(all.text).toContain('session other-se cwd=/elsewhere')
  expect(all.text).toContain('session sess-1 cwd=/work/repo')
})

test('a status line summarises the workers after each change', async ($, on) => {
  const saved = new Map<string, unknown>()
  const lines: string[] = []
  mock.clock(on, { now: 1000 })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.repo', () => ({ value: null }))
  on('store.set', ($: any, e: any) => { saved.set(e.key, e.value); return { value: undefined } })
  on('ui.status', ($: any, e: any) => { lines.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  mock.env(on, {})
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ prompt: 'x', description: 'd', subagentType: 'agent-tree:worker' })
  expect(lines[lines.length - 1]).toBe('1 running / 1 total · worker sonnet-5 0…')

  await $.turn.complete({ turnId: 't', agentId: 'a1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as any)
  expect(lines[lines.length - 1]).toBe('0 running / 1 total · worker sonnet-5 0✓')
})

test('a lead sees only its own department through the status tool; main sees all', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  let n = 0
  on('agent.spawn', ($: any, e: any) => ({ model: 'claude-sonnet-5', agentId: e.subagentType === 'agent-tree:lead' ? 'lead-' + ++n : 'w-' + ++n }))
  on('turn.complete', () => ({ text: '' }))

  await $.agent.spawn({ prompt: 'area A', description: 'api', subagentType: 'agent-tree:lead' })
  await $.agent.spawn({ prompt: 'piece 1', description: 'endpoint', subagentType: 'agent-tree:worker', parentAgentId: 'lead-1' } as any)
  await $.agent.spawn({ prompt: 'piece 2', description: 'tests', subagentType: 'agent-tree:worker', parentAgentId: 'lead-1' } as any)
  await $.agent.spawn({ prompt: 'area B', description: 'docs', subagentType: 'agent-tree:lead' })
  await $.turn.complete({ turnId: 't', agentId: 'w-2', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as any)

  const lead = await $.tool.call({ tool: 'mcp__agent-tree__status', agentId: 'lead-1' } as any)
  expect(lead.result.split('\n')[0]).toBe('jev: off (no TYPESAFE_API_KEY; pick model yourself)')
  expect(lead.result).toContain('lead-1 (you)')
  expect(lead.result).toContain('w-2 agent-tree:worker')
  expect(lead.result).toContain('w-3 agent-tree:worker')
  expect(lead.result).not.toContain('lead-4')

  const main = await $.tool.call({ tool: 'mcp__agent-tree__status' })
  expect(main.result.split('\n')[1]).toBe('main')
  expect(main.result).toContain('lead-1 agent-tree:lead')
  expect(main.result).toContain('lead-4 agent-tree:lead')
  expect(main.result).toContain('    w-2 agent-tree:worker claude-sonnet-5 done')

  const line = (await $.command.run({ command: 'agent-tree', args: '' })).text
  expect(line).toContain('lead-1 agent-tree:lead')
})

test('/agent-tree list groups sessions by repo and worktree', async ($, on) => {
  const saved = new Map<string, unknown>()
  const base = { main: { tokens: {} }, workers: {}, links: [] }
  saved.set('session:a', { ...base, id: 'aaaaaaaa-1', cwd: '/w/app', repo: { root: '/w/app', remote: 'git@x:app', name: 'app' }, updatedAt: 2 })
  saved.set('session:b', { ...base, id: 'bbbbbbbb-1', cwd: '/w/app-wt2', repo: { root: '/w/app-wt2', remote: 'git@x:app', name: 'app' }, updatedAt: 3,
    orca: { workspace: 'ws9', worktree: 'wt2', pane: 'p1' }, links: [{ dir: 'out', to: 'aaaaaaaa-1', at: 1 }, { dir: 'in', from: 'lead-a', at: 2 }] })
  saved.set('session:c', { ...base, id: 'cccccccc-1', cwd: '/tmp/x', repo: null, updatedAt: 1, endedAt: 5 })
  baseStubs(on, saved)

  const out = (await $.command.run({ command: 'agent-tree', args: 'list' })).text.split('\n')
  expect(out[0]).toBe('repo git@x:app')
  expect(out).toContain('  worktree /w/app')
  expect(out).toContain('  worktree /w/app-wt2')
  expect(out).toContain('    session bbbbbbbb cwd=/w/app-wt2 orca=ws9/wt2 links: →aaaaaaaa ←lead-a')
  expect(out).toContain('repo (no repo)')
  expect(out).toContain('    session cccccccc cwd=/tmp/x [ended]')
})

test('orca tags and cross-session messages are recorded', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, { ORCA_WORKSPACE_ID: 'ws1', ORCA_WORKTREE_ID: 'wt1', ORCA_PANE_KEY: 'pane1' })
  on('session.send', () => ({ isDelivered: true }))
  on('session.receive', ($: any, e: any) => ({ text: e.text }))

  await $.session.send({ to: 'other-session', text: 'status?', origin: { kind: 'model' } } as any)
  await $.session.receive({ origin: { kind: 'peer' }, text: 'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="session-1" from-mode="prompting">\nhello' } as any)

  const snap = saved.get(KEY) as any
  expect(snap.orca).toEqual({ workspace: 'ws1', worktree: 'wt1', pane: 'pane1' })
  expect(snap.links).toEqual([
    { dir: 'out', to: 'other-session', agentId: null, at: 1000 },
    { dir: 'in', from: 'session-1', fromAddr: 'uds:/tmp/cc-socks/1.sock', agentId: null, at: 1000 },
  ])
})

test('the pane draws a card per department with its workers and a log', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  let n = 0
  on('agent.spawn', ($: any, e: any) => ({ model: 'claude-sonnet-5', agentId: (e.subagentType === 'agent-tree:lead' ? 'lead-' : 'w-') + ++n }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage('claude-sonnet-5') }
  })

  await $.agent.spawn({ prompt: 'area', description: 'api', subagentType: 'agent-tree:lead' })
  await $.agent.spawn({ prompt: 'piece', description: 'endpoint', subagentType: 'agent-tree:worker', parentAgentId: 'lead-1' } as any)
  await runStep($, 'w-2')
  await runStep($, 'lead-1')
  await $.turn.complete({ turnId: 't', agentId: 'w-2', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'lead' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /endpoint/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 done/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^done\s*$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▼/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/agent-tree open and close drive the pane', async ($, on) => {
  const calls: string[] = []
  on('ui.open', ($: any, e: any) => { calls.push('open:' + e.id + ':' + (e.focus ? 'focus' : 'nofocus')); return { value: { isPlaced: true } } })
  on('ui.close', ($: any, e: any) => { calls.push('close:' + e.id); return { value: undefined } })

  expect(await $.command.run({ command: 'agent-tree', args: 'open' })).toEqual({})
  expect(await $.command.run({ command: 'agent-tree', args: 'close' })).toEqual({})
  expect(calls).toEqual(['open:agent-tree:focus', 'close:agent-tree', 'close:agent-tree-fleet'])
})

function rowText(segs: any[]) {
  return segs.map((s) => s.text).join('')
}

test('graphRows draws main over leads over workers with connectors', () => {
  const view = {
    session: { id: 'sess-1' },
    main: { model: 'claude-opus-5-5', effort: 'high', steps: 3, tokens: { 'claude-opus-5-5': { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 } } },
    workers: {
      'lead-1': { type: 'agent-tree:lead', description: 'api', status: 'done', model: 'claude-sonnet-5', steps: 2, tokens: {}, jev: { ok: true, choice: 'opus', confidence: 0.91, applied: true } },
      'w-2': { type: 'agent-tree:worker', description: 'endpoint', status: 'done', model: 'claude-sonnet-5', steps: 4, tokens: {}, parentAgentId: 'lead-1', jev: null },
      'w-3': { type: 'agent-tree:worker', description: 'tests', status: 'running', model: 'claude-sonnet-5', steps: 1, tokens: {}, parentAgentId: 'lead-1', jev: null },
      'lead-4': { type: 'agent-tree:lead', description: 'docs', status: 'running', model: 'claude-sonnet-5', steps: 1, tokens: {}, jev: null },
    },
  }
  const rows = graphRows(view, 120)!
  const text = rows.map(rowText)
  // three card levels (5 rows each) and two connector bands (3 rows each)
  expect(text.length).toBe(5 * 3 + 3 * 2)
  expect(text[1]).toContain('main · sess-1')
  expect(text[2]).toContain('opus-5-5 · high')
  // main fans out to two leads: a bar with a corner at each end and ▼ into each card
  expect(text[6]).toMatch(/┌─+[┴┼]─+┐/)
  expect((text[7].match(/▼/g) ?? []).length).toBe(2)
  expect(text[9]).toContain('lead')
  expect(text[9]).toContain('api')
  expect(text[9]).toContain('docs')
  expect(text[10]).toContain('jev opus 0.91 ★')
  // the api lead fans out to two workers; the docs lead has none
  expect((text[15].match(/▼/g) ?? []).length).toBe(2)
  expect(text[17]).toContain('worker')
  expect(text[17]).toContain('endpoint')
  expect(text[17]).toContain('tests')
  // every row is the same width and never wider than the viewport
  for (const row of text) expect(row.length).toBe(text[0].length)
  expect(text[0].length <= 120).toBe(true)
})

test('graphRows gives up below the narrowest layout', () => {
  const view = { session: { id: 's' }, main: { tokens: {} }, workers: { a: { type: 'x', status: 'running', tokens: {}, steps: 0 }, b: { type: 'y', status: 'running', tokens: {}, steps: 0 }, c: { type: 'z', status: 'running', tokens: {}, steps: 0 } } }
  expect(graphRows(view, 40)).toBe(null)
  expect(graphMinWidth(view)).toBe(14 * 3 + 2 * 2)
  expect(graphRows(view, 46)).not.toBe(null)
})

const FLEET_PANE = {
  plugin: 'agent-tree',
  component: 'Pane',
  requestId: 'agent-tree-fleet',
  viewport: { columns: 160, rows: 50 },
  props: { title: 'fleet', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

function fleetStore(saved: Map<string, unknown>) {
  const tok = (m: string, n: number) => ({ [m]: { input: n, output: 0, cacheRead: 0, cacheWrite: 0 } })
  const w = (type: string, status: string, extra: any = {}) => ({ type: 'agent-tree:' + type, description: 'd', status, model: 'claude-sonnet-5', steps: 1, tokens: tok('claude-sonnet-5', 100), jev: null, ...extra })
  saved.set('session:a', { id: 'aaaaaaaa-1', cwd: '/w/stand', repo: { root: '/w/stand', remote: 'git@github.com:example/stand.git', name: null }, updatedAt: 2, main: { model: 'claude-opus-5-5', tokens: tok('claude-opus-5-5', 1000) },
    workers: { l1: w('lead', 'running'), w2: w('worker', 'done', { parentAgentId: 'l1' }) }, links: [{ dir: 'out', to: 'bbbbbbbb-1', at: 1 }] })
  saved.set('session:b', { id: 'bbbbbbbb-1', cwd: '/w/stand-wt2', repo: { root: '/w/stand-wt2', remote: 'git@github.com:example/stand.git', name: null }, updatedAt: 3, main: { model: 'claude-opus-5-5', tokens: tok('claude-opus-5-5', 500) },
    workers: { w1: w('worker', 'done') }, links: [], orca: { workspace: 'ws1', worktree: 'wt2', pane: 'p' } })
  saved.set('session:c', { id: 'cccccccc-1', cwd: '/w/notes', repo: { root: '/w/notes', remote: 'ssh://github.com/example/notes', name: null }, updatedAt: 1, main: { model: 'claude-fable-5-1', tokens: tok('claude-fable-5-1', 9000) }, workers: {}, links: [], endedAt: 9 })
}

test('/agent-tree all opens the fleet pane with the filter from its arguments', async ($, on) => {
  const opens: any[] = []
  on('ui.open', ($: any, e: any) => { opens.push(e); return { value: { isPlaced: true } } })
  expect(await $.command.run({ command: 'agent-tree', args: 'all stand --running' })).toEqual({})
  expect(opens[0].id).toBe('agent-tree-fleet')
  expect(opens[0].focus).toBe(true)
})

test('the fleet pane groups every session and its tabs filter by repo, running and worktree', async ($, on) => {
  const saved = new Map<string, unknown>()
  fleetStore(saved)
  baseStubs(on, saved)
  mock.env(on, {})

  const ui = await $.ui.mount({ ...FLEET_PANE, surface: 'terminal' })
  // tabs: all + the two repo names, plus the two toggles
  expect(await ui.find({ key: 'tab-all' })).toBeDefined()
  expect(await ui.find({ key: 'tab-stand' })).toBeDefined()
  expect(await ui.find({ key: 'tab-notes' })).toBeDefined()
  expect(await ui.find({ key: 'tab-running' })).toBeDefined()
  // grouping and the per-session line
  expect(await ui.find({ type: 'Text', text: 'repo git@github.com:example/stand.git' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'repo ssh://github.com/example/notes' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /orca=ws1\/wt2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[ended\]/ })).toBeDefined()
  // session c has no subagents: a one-line summary, no main card
  expect(await ui.find({ type: 'Text', text: /idle · no requests yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /main · cccccccc/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /fleet · 2 repos · 3 worktrees · 3 sessions/ })).toBeDefined()
  // the graph of session a is drawn (its lead card)
  expect(await ui.find({ type: 'Text', text: 'lead' })).toBeDefined()

  // press the stand tab: notes disappears
  await ui.press({ key: 'tab-stand' })
  expect(await ui.find({ type: 'Text', text: 'repo ssh://github.com/example/notes' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /2 sessions/ })).toBeDefined()

  // running only: session b (all done) disappears too
  await ui.press({ key: 'tab-running' })
  expect(await ui.find({ type: 'Text', text: /1 sessions/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /orca=ws1/ })).toBeUndefined()

  // back to all, then this worktree only (the test session's cwd is /work/repo: nothing matches)
  await ui.press({ key: 'tab-all' })
  await ui.press({ key: 'tab-running' })
  await ui.press({ key: 'tab-worktree' })
  expect(await ui.find({ type: 'Text', text: 'no sessions match' })).toBeDefined()
  await ui.unmount()
})

test('the status line shows main alone before any subagent starts', async ($, on) => {
  const lines: string[] = []
  mock.clock(on, { now: 1000 })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.repo', () => ({ value: null }))
  on('store.set', () => ({ value: undefined }))
  on('ui.status', ($: any, e: any) => { lines.push(e.text); return { value: undefined } })
  mock.env(on, {})
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage('claude-opus-5-5') }
  })
  await runStep($)
  expect(lines[lines.length - 1]).toBe('main opus-5-5 · 1 steps · no subagents yet')
})

test('session.start reads this session’s record back after a reload', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set(KEY, { id: 'sess-1', cwd: '/work/repo', repo: null, main: { model: 'claude-opus-5-5', steps: 4, tokens: {} }, links: [],
    events: [{ at: 1, kind: 'spawn', type: 'factory:lead', description: 'api', note: '' }],
    workers: { 'lead-1': { type: 'factory:lead', description: 'api', status: 'running', model: 'claude-sonnet-5', steps: 2, tokens: {}, jev: null } } })
  baseStubs(on, saved)
  mock.env(on, {})
  on('session.start', () => ({ cwd: '/work/repo' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/repo' } as any)

  const mine = await $.command.run({ command: 'agent-tree', args: '' })
  expect(mine.text).toContain('lead-1 factory:lead claude-sonnet-5 running steps=2')
  const snap = saved.get(KEY) as any
  expect(snap.workers['lead-1'].description).toBe('api')
  expect(snap.events.length).toBe(1)
  expect(snap.main.steps).toBe(4)
})

test('a worker first seen in turn.step is identified through agent.list', async ($, on) => {
  const saved = new Map<string, unknown>()
  mock.clock(on, { now: 1000 })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.repo', () => ({ value: null }))
  on('store.set', ($: any, e: any) => { saved.set(e.key, e.value); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [{ id: 'a9', type: 'factory:lead', description: 'auth area', status: 'running', parentId: undefined }] }))
  mock.env(on, {})
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage('claude-sonnet-5') }
  })

  await runStep($, 'a9')

  const snap = saved.get(KEY) as any
  expect(snap.workers.a9.type).toBe('factory:lead')
  expect(snap.workers.a9.description).toBe('auth area')
})

test('unknown workers read back from the store are re-identified through agent.list', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set(KEY, { id: 'sess-1', cwd: '/work/repo', repo: null, main: { steps: 1, tokens: {} }, links: [], events: [],
    workers: { 'a9': { type: 'unknown', description: '', status: 'running', model: 'claude-sonnet-5', steps: 2, tokens: {}, jev: null, parentAgentId: null } } })
  mock.clock(on, { now: 1000 })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.repo', () => ({ value: null }))
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.set', ($: any, e: any) => { saved.set(e.key, e.value); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [{ id: 'a9', type: 'factory:lead', description: 'auth', status: 'running' }] }))
  mock.env(on, {})
  on('session.start', () => ({ cwd: '/work/repo' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/repo' } as any)

  const snap = saved.get(KEY) as any
  expect(snap.workers.a9.type).toBe('factory:lead')
  expect(snap.workers.a9.description).toBe('auth')
})

test('both panes have a close button and /agent-tree close closes both', async ($, on) => {
  const saved = new Map<string, unknown>()
  fleetStore(saved)
  mock.clock(on, { now: 1000 })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.repo', () => ({ value: null }))
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('store.set', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  mock.env(on, {})
  const closed: string[] = []
  on('ui.close', ($: any, e: any) => { closed.push(e.id); return { value: undefined } })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'close' })
  await pane.unmount()
  const fleet = await $.ui.mount({ ...FLEET_PANE, surface: 'terminal' })
  await fleet.press({ key: 'close' })
  await fleet.unmount()
  await $.command.run({ command: 'agent-tree', args: 'close' })

  expect(closed).toEqual(['agent-tree', 'agent-tree-fleet', 'agent-tree', 'agent-tree-fleet'])
})

test('the fleet pane falls back to an indented tree when the boxes do not fit', async ($, on) => {
  const saved = new Map<string, unknown>()
  const w = (status: string, extra: any = {}) => ({ type: 'factory:worker', description: 'd', status, model: 'claude-sonnet-5', steps: 1, tokens: {}, jev: null, ...extra })
  saved.set('session:x', { id: 'xxxxxxxx-1', cwd: '/w/x', repo: null, updatedAt: 1, main: { tokens: {} }, links: [],
    workers: { l1: { ...w('running'), type: 'factory:lead' }, w2: w('done'), w3: w('done'), w4: w('done', { parentAgentId: 'l1' }) } })
  baseStubs(on, saved)
  mock.env(on, {})

  // three top-level cards need 58 columns; 30 - 6 leaves 24
  const narrow = { ...FLEET_PANE, props: { ...FLEET_PANE.props, bodyColumns: 30 } }
  const ui = await $.ui.mount({ ...narrow, surface: 'terminal' })
  // no box graph at 30 columns, but the lead and its worker are listed
  expect(await ui.find({ type: 'Text', text: /▼/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^\s*lead sonnet-5 …$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s+worker sonnet-5 ✓$/ })).toBeDefined()
  await ui.unmount()
})

test('/agent-tree env reports the surface facts behind pane placement', async ($, on) => {
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.panes', () => ({ value: [{ id: 'agent-tree-fleet', title: 'fleet', isShown: true, isFocused: false, isPlaced: true }] }))
  const out = (await $.command.run({ command: 'agent-tree', args: 'env', presentation: { isFullscreen: true, columns: 80 } } as any)).text
  expect(out).toContain('surfaces: terminal')
  expect(out).toContain('terminal: 80 columns · fullscreen=true → a pane goes above the prompt (needs 110 columns)')
  expect(out).toContain('pane agent-tree-fleet: shown=true focused=false placed=true')
})

test('/agent-tree focus re-opens the shown pane with the keyboard', async ($, on) => {
  const opens: any[] = []
  on('ui.panes', () => ({ value: [{ id: 'agent-tree', title: 'agent-tree', isShown: false, isFocused: false, isPlaced: true }, { id: 'agent-tree-fleet', title: 'fleet', isShown: true, isFocused: false, isPlaced: true }] }))
  on('ui.open', ($: any, e: any) => { opens.push(e); return { value: { isPlaced: true } } })
  expect(await $.command.run({ command: 'agent-tree', args: 'focus' })).toEqual({})
  expect(opens[0].id).toBe('agent-tree-fleet')
  expect(opens[0].focus).toBe(true)
})

test('a worker that steps again after done goes back to running and logs a resume', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* ($: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage('claude-sonnet-5') }
  })

  await $.agent.spawn({ prompt: 'x', description: 'lead', subagentType: 'factory:lead' })
  await $.turn.complete({ turnId: 't', agentId: 'a1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as any)
  expect((saved.get(KEY) as any).workers.a1.status).toBe('done')
  await runStep($, 'a1')
  const snap = saved.get(KEY) as any
  expect(snap.workers.a1.status).toBe('running')
  expect(snap.events.map((e: any) => e.kind)).toEqual(['spawn', 'done', 'resume'])
})

test('the session pane always draws the graph, windowed and scrollable when too wide', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'w-' + ++n }))
  for (let i = 0; i < 3; i++) await $.agent.spawn({ prompt: 'x', description: 'piece ' + i, subagentType: 'factory:worker' })

  // three cards need 46 columns; the pane has 40, so a 40-wide window scrolls over 46
  const narrow = { ...PANE, props: { ...PANE.props, bodyColumns: 40 } }
  const ui = await $.ui.mount({ ...narrow, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /▼/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cols \d+–\d+ of 46/ })).toBeDefined()
  expect(await ui.find({ key: 'left' })).toBeDefined()
  await ui.press({ key: 'right' })
  expect(await ui.find({ type: 'Text', text: /cols 7–46 of 46/ })).toBeDefined()
  // g switches to the card list and back
  await ui.press({ key: 'mode' })
  expect(await ui.find({ type: 'Text', text: /▼/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'departments' })).toBeDefined()
  await ui.press({ key: 'mode' })
  expect(await ui.find({ type: 'Text', text: /▼/ })).toBeDefined()
  await ui.unmount()
})
test('parseSender reads the address and name from a received message', () => {
  expect(parseSender('x\n<cross-session-message from="uds:/tmp/cc-socks/9.sock" from-name="session-1" from-mode="prompting">\nhi')).toEqual({ addr: 'uds:/tmp/cc-socks/9.sock', name: 'session-1' })
  expect(parseSender('plain text')).toEqual({ addr: null, name: null })
})

test('sessionEdges joins sessions by socket, by name, and by time', () => {
  const a = { id: 'aaaaaaaa-1', socket: 'uds:/tmp/a.sock', workers: { 'lead-7': { type: 'factory:lead' } }, links: [
    { dir: 'out', to: 'session-2', at: 1000 },
    { dir: 'out', to: 'lead-7', at: 2000 },
    { dir: 'in', from: 'session-2', fromAddr: 'uds:/tmp/b.sock', at: 5000 },
    { dir: 'out', to: 'nobody', at: 9000 },
  ] }
  const b = { id: 'bbbbbbbb-1', socket: 'uds:/tmp/b.sock', links: [
    { dir: 'in', from: 'session-1', fromAddr: 'uds:/tmp/a.sock', at: 1001 },
    { dir: 'out', to: 'uds:/tmp/a.sock', at: 5000 },
  ] }
  const edges = sessionEdges([a, b])
  // sorted by time; the message to a's own subagent lead-7 is left out
  expect(edges).toEqual([
    { from: 'aaaaaaaa-1', to: 'bbbbbbbb-1', raw: 'session-2', at: 1000 },
    { from: 'bbbbbbbb-1', to: 'aaaaaaaa-1', raw: 'uds:/tmp/a.sock', at: 5000 },
    { from: 'aaaaaaaa-1', to: null, raw: 'nobody', at: 9000 },
  ])
})

test('the fleet pane shows session names and a messages block', async ($, on) => {
  const saved = new Map<string, unknown>()
  const base = { cwd: '/w/x', repo: null, updatedAt: 1, main: { tokens: {} }, workers: {}, events: [] }
  saved.set('session:a', { ...base, id: 'aaaaaaaa-1', socket: 'uds:/tmp/a.sock', links: [{ dir: 'out', to: 'session-2', at: 1000 }, { dir: 'in', from: 'session-2', fromAddr: 'uds:/tmp/b.sock', at: 5000 }] })
  saved.set('session:b', { ...base, id: 'bbbbbbbb-1', socket: 'uds:/tmp/b.sock', links: [{ dir: 'in', from: 'session-1', fromAddr: 'uds:/tmp/a.sock', at: 1001 }, { dir: 'out', to: 'uds:/tmp/a.sock', at: 5000 }] })
  baseStubs(on, saved)
  mock.env(on, {})

  const ui = await $.ui.mount({ ...FLEET_PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' "session-1"' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' "session-2"' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'messages' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /aaaaaaaa "session-1" → bbbbbbbb "session-2"/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /bbbbbbbb "session-2" → aaaaaaaa "session-1"/ })).toBeDefined()
  await ui.unmount()
})

test('graphWindow centres on main and clamps to the canvas', () => {
  const view = { session: { id: 's' }, main: { tokens: {} }, workers: { a: { type: 'x', status: 'running', tokens: {}, steps: 0 }, b: { type: 'y', status: 'running', tokens: {}, steps: 0 }, c: { type: 'z', status: 'running', tokens: {}, steps: 0 } } }
  const w = graphWindow(view, 20, null)
  expect(w.width).toBe(46)
  expect(w.maxOffset).toBe(26)
  expect(w.offset).toBe(13)
  for (const row of w.rows) expect(row.map((s) => s.text).join('').length).toBe(20)
  expect(graphWindow(view, 20, 999).offset).toBe(26)
  expect(graphWindow(view, 20, -5).offset).toBe(0)
  expect(graphWindow(view, 100, null).maxOffset).toBe(0)
})

test('the details select shows an agent’s report', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ prompt: 'x', description: 'build the parser', subagentType: 'factory:worker' })
  await $.turn.complete({ turnId: 't', agentId: 'a1', answer: 'Parser done. 12 tests pass. Left: error messages.', durationMs: 42000, isAborted: false, reason: 'answer' } as any)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'details' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Parser done/ })).toBeUndefined()
  await ui.select({ key: 'details', value: 'a1' })
  expect(await ui.find({ type: 'Text', text: /Parser done\. 12 tests pass/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /42s/ })).toBeDefined()
  await ui.unmount()
})

test('an empty session pane points at the previous session in the same directory', async ($, on) => {
  const saved = new Map<string, unknown>()
  saved.set('session:old', { id: 'oldoldol-1', cwd: '/work/repo', repo: null, updatedAt: 5, main: { tokens: {} }, links: [], events: [],
    workers: { a: { type: 'factory:worker', status: 'done', tokens: {}, steps: 1 }, b: { type: 'factory:worker', status: 'done', tokens: {}, steps: 1 } } })
  baseStubs(on, saved)
  mock.env(on, {})
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /last session here \(oldoldol, 2 agents\) is in \/agent-tree all/ })).toBeDefined()
  await ui.unmount()
})

test('after a resume the new session adopts the old session’s record from the transcript', async ($, on) => {
  const saved = new Map<string, unknown>()
  const OLD = '11111111-2222-3333-4444-555555555555'
  saved.set('session:' + OLD, { id: OLD, cwd: '/work/repo', repo: null, updatedAt: 5, main: { model: 'claude-opus-5-5', steps: 9, tokens: {} }, links: [], events: [{ at: 1, kind: 'spawn', type: 'factory:lead', description: 'api', note: '' }],
    workers: { 'lead-1': { type: 'factory:lead', description: 'api', status: 'done', model: 'claude-sonnet-5', steps: 3, tokens: {}, jev: null } } })
  mock.clock(on, { now: 1000 })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/work/repo' }))
  on('session.repo', () => ({ value: null }))
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.set', ($: any, e: any) => { saved.set(e.key, e.value); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', ($: any, e: any) => {
    expect(e.argv).toEqual(['head', '-c', '400000', '/tmp/t.jsonl'])
    return { value: { exitCode: 0, stdout: '{"type":"user","sessionId":"' + OLD + '","cwd":"/work/repo"}\n{"type":"assistant","sessionId":"' + OLD + '"}\n', stderr: '' } }
  })
  mock.env(on, {})
  on('classic.SessionStart', () => ({}))

  await $.classic.SessionStart({ source: 'resume', transcript_path: '/tmp/t.jsonl', session_id: 'sess-1' } as any)

  const snap = saved.get(KEY) as any
  expect(snap.resumedFrom).toBe(OLD)
  expect(snap.workers['lead-1'].description).toBe('api')
  expect(snap.main.steps).toBe(9)
  expect(snap.events.length).toBe(1)
})

test('the session pane still draws with more agents than a Select may list, paging the details picker', async ($, on) => {
  const saved = new Map<string, unknown>()
  baseStubs(on, saved)
  mock.env(on, {})
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'w-' + ++n }))
  on('turn.complete', () => ({ text: '' }))
  // The engine refuses a Select with more than 64 options, and with it the whole pane.
  for (let i = 1; i <= 70; i++) await $.agent.spawn({ prompt: 'x', description: 'piece ' + i, subagentType: 'factory:worker' })
  await $.turn.complete({ turnId: 't', agentId: 'w-70', answer: 'Seventieth report.', durationMs: 5, isAborted: false, reason: 'answer' } as any)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /70 agents/ })).toBeDefined()
  expect(await ui.find({ key: 'details' })).toBeDefined()
  // w-70 sits on the second page: step there through the sentinel entry, then pick it.
  await ui.select({ key: 'details', value: 'page:next' })
  await ui.select({ key: 'details', value: 'w-70' })
  expect(await ui.find({ type: 'Text', text: /Seventieth report/ })).toBeDefined()
  await ui.unmount()
})
