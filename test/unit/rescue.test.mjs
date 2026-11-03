import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../packages/dsh-tool-ultra-core/lib/index.js'

// The core applied to a minimal host: a tool registry, Cordis-like events with
// serial(), one live agent that can be restricted, and the provided service.
function coreHost(toolNames) {
  const tools = new Map(toolNames.map((n) => [n, { name: n, description: `${n} does things.`, parameters: {} }]))
  const listeners = new Map()
  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(handler)
    return () => listeners.set(event, listeners.get(event).filter((h) => h !== handler))
  }
  const agent = { id: 's1', options: { provider: 'fake' }, ctx: { tools: { restrict: () => () => {} } } }
  const services = {}
  const effect = (fn) => fn()
  const ctx = {
    logger: () => ({ warn() {}, info() {}, debug() {} }),
    tools: {
      schemas: () => [...tools.values()],
      register: (def) => { tools.set(def.name, { name: def.name, description: def.description ?? '', parameters: {} }); return () => tools.delete(def.name) },
    },
    on,
    emit: (event, ...args) => { for (const h of listeners.get(event) ?? []) h(...args) },
    serial: async (event, ...args) => { for (const h of listeners.get(event) ?? []) await h(...args) },
    effect,
    provide: (name, service) => { services[name] = service },
    inject: (deps, fn) => fn({ agents: { list: () => [agent], get: () => undefined }, effect, on }),
    get: () => undefined,
  }
  // The rescue feature does not exercise the router, so keep the sidecar out:
  // a spawned sidecar child would keep the event loop alive past the test.
  apply(ctx, { sidecar: { bin: '/nonexistent' } })
  const catalog = services.toolCatalog
  // `admitted` stands in for DSH 0.2.2's step tool set; omitted, the host is DSH 0.2.1.
  const preExecute = (name, admitted) => {
    const toolSet = admitted && { view: (scope) => new Set(scope === agent ? admitted : []) }
    return listeners.get('tools/pre-execute')[0]({ agent, name, arguments: {}, toolSet }, async () => ({ kind: 'allow' }))
  }
  return { ctx, on, agent, catalog, preExecute }
}

test('rescue: a direct call of a hidden ordinary tool is auto-loaded', async () => {
  const { agent, catalog, preExecute } = coreHost(['hidden_tool'])
  assert.deepEqual(await preExecute('hidden_tool'), { kind: 'allow' })
  assert.ok(catalog.stateOf(agent).loaded.has('hidden_tool'))
})

test('rescue: a before-load veto stops the auto-load', async () => {
  const { on, agent, catalog, preExecute } = coreHost(['hidden_tool'])
  let payload
  on('tool-catalog/before-load', (p) => { payload = p; throw new Error('vetoed by test') })
  const decision = await preExecute('hidden_tool')
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /vetoed by test/)
  assert.equal(payload.rescue, true)
  assert.deepEqual(payload.names, ['hidden_tool'])
  assert.equal(catalog.stateOf(agent).loaded.has('hidden_tool'), false)
})

test('rescue: a tool a visibility filter keeps out is refused and not left loaded', async () => {
  const { agent, catalog, preExecute } = coreHost(['hidden_tool', 'other_tool'])
  catalog.registerVisibilityFilter({ name: 'no-hidden', filter: (_agent, names) => names.filter((n) => n !== 'hidden_tool') })
  const decision = await preExecute('hidden_tool')
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /not available in this session/)
  assert.equal(catalog.stateOf(agent).loaded.has('hidden_tool'), false)
})

test('rescue: with a step tool set, the loaded tool is refused for this step with a retry hint', async () => {
  const { agent, catalog, preExecute } = coreHost(['hidden_tool'])
  const decision = await preExecute('hidden_tool', [])
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /"hidden_tool" was not loaded.*call it again/)
  assert.ok(catalog.stateOf(agent).loaded.has('hidden_tool'))
})

test('rescue: with a step tool set that admits the tool, the call proceeds', async () => {
  const { preExecute } = coreHost(['hidden_tool'])
  await preExecute('hidden_tool', [])
  assert.deepEqual(await preExecute('hidden_tool', ['hidden_tool']), { kind: 'allow' })
})
