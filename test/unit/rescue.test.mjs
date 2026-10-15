import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../packages/dsh-tool-manager/lib/index.js'

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
  apply(ctx, {})
  const catalog = services.toolCatalog
  const preExecute = (name) => listeners.get('tools/pre-execute')[0]({ agent, name, arguments: {} }, async () => ({ kind: 'allow' }))
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
