import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../packages/dsh-tool-ultra-core/lib/index.js'

// Hybrid search: the keyword match first, then the ranked index, then a
// registered fallback (a small model). These tests exercise the plumbing
// through the real `tools_ls` and `toolCatalog.find()`, not a mock.

function coreHost(tools) {
  const registry = new Map(tools.map((t) => [t.name, { name: t.name, description: t.description, parameters: {} }]))
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
      schemas: () => [...registry.values()],
      // The full definition is kept, so the test can call tools_ls itself.
      register: (def) => { registry.set(def.name, def); return () => registry.delete(def.name) },
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
  return { ctx, agent, catalog: services.toolCatalog, registry }
}

const TOOLS = [
  { name: 'notes_search', description: 'Search personal notes by keyword.' },
  { name: 'maps_weather', description: 'Get the weather forecast for a city.' },
  { name: 'device_battery', description: 'Report battery level of the paired phone.' },
]

test('a keyword query still finds the tool', () => {
  const { catalog } = coreHost(TOOLS)
  const results = catalog.find('weather forecast')
  assert.ok(results.some((t) => t.name === 'maps_weather'), 'maps_weather must be found by the keyword match')
})

test('a plain-language query falls back to the ranked index', () => {
  const { catalog } = coreHost(TOOLS)
  const results = catalog.find('is my phone charged')
  assert.ok(results.some((t) => t.name === 'device_battery'), 'device_battery must be found by the ranked index')
})

test('a registered fallback is asked only when the keyword match found nothing', async () => {
  const { catalog, registry, agent } = coreHost(TOOLS)
  const ls = registry.get('tools_ls')
  assert.ok(ls, 'tools_ls must be registered')
  const queries = []
  catalog.registerSearchFallback(async (query) => {
    queries.push(query)
    return []
  })
  await ls.execute({ query: 'weather forecast' }, { agent })
  assert.deepEqual(queries, [], 'the fallback must not be called for a keyword hit')
  await ls.execute({ query: 'is my phone charged' }, { agent })
  assert.deepEqual(queries, ['is my phone charged'], 'the fallback must be called with the exact query')
})

test("the fallback's hits reach the listing", async () => {
  const { catalog, registry, agent } = coreHost(TOOLS)
  const ls = registry.get('tools_ls')
  catalog.registerSearchFallback(async () => ([{
    name: 'notes_search',
    short: 'notes_search',
    path: '/other/other/notes_search',
    category: 'other',
    group: 'other',
    summary: 'Search personal notes by keyword.',
    tokens: 10,
    highRisk: false,
  }]))
  const out = await ls.execute({ query: 'what did I write' }, { agent })
  assert.equal(typeof out, 'string')
  assert.ok(out.includes('notes_search'), 'the listing must contain notes_search')
})

test('a failing fallback does not break the search', async () => {
  const { catalog, registry, agent } = coreHost(TOOLS)
  const ls = registry.get('tools_ls')
  catalog.registerSearchFallback(async () => { throw new Error('boom') })
  const out = await ls.execute({ query: 'is my phone charged' }, { agent })
  assert.equal(typeof out, 'string', 'tools_ls must still return a string')
})

test('a fallback that names a tool the catalog does not have is ignored', async () => {
  const { catalog, registry, agent } = coreHost(TOOLS)
  const ls = registry.get('tools_ls')
  catalog.registerSearchFallback(async () => ([{
    name: 'no_such_tool',
    short: 'no_such_tool',
    path: '/other/other/no_such_tool',
    category: 'other',
    group: 'other',
    summary: 'A tool that does not exist.',
    tokens: 10,
    highRisk: false,
  }]))
  const out = await ls.execute({ query: 'is my phone charged' }, { agent })
  assert.equal(typeof out, 'string')
  assert.ok(!out.includes('no_such_tool'), 'the listing must not contain no_such_tool')
})