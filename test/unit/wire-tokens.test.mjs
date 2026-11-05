import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../packages/dsh-tool-ultra-core/lib/index.js'

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
  apply(ctx, { sidecar: { bin: '/nonexistent' } })
  return { ctx, agent, catalog: services.toolCatalog }
}

test('wireTokens counts entry tools and loaded tools, never unloaded ones', async () => {
  const { agent, catalog } = coreHost(['alpha', 'beta'])
  const fresh = catalog.wireTokens(agent)
  assert.ok(fresh > 0, `fresh session should count the entry tools, got ${fresh}`)

  await catalog.load(agent, ['alpha'])
  const loaded = catalog.wireTokens(agent)
  assert.ok(loaded > fresh, `loading alpha should strictly increase tokens: ${loaded} <= ${fresh}`)

  await catalog.unload(agent, ['alpha'])
  const after = catalog.wireTokens(agent)
  assert.equal(after, fresh, `unloading alpha should return to the fresh value, got ${after}`)

  // beta was registered but never loaded: it must not be visible, so it
  // contributes nothing to the fresh / after values above.
  assert.equal(catalog.allowFor(agent).includes('beta'), false)
})