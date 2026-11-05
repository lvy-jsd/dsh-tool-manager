import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../packages/dsh-tool-ultra-core/lib/index.js'
import { estimateTokens } from '../../packages/dsh-tool-ultra-core/lib/catalog.js'

function coreHost(toolNames) {
  const tools = new Map(toolNames.map((n) => [n, { name: n, description: `${n} does things.`, parameters: {} }]))
  const listeners = new Map()
  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(handler)
    return () => listeners.set(event, listeners.get(event).filter((h) => h !== handler))
  }
  const agent = { id: 's1', options: { provider: 'fake' }, ctx: { tools: { restrict: () => () => {} } } }
  const otherAgent = { id: 's2', options: { provider: 'fake' }, ctx: { tools: { restrict: () => () => {} } } }
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
  return { ctx, agent, otherAgent, catalog: services.toolCatalog }
}

const content = [{ type: 'text', text: 'four Chinese speakers 你好世界' }]

test('resultTokens starts at zero and accumulates final tool results', () => {
  const { ctx, agent, catalog } = coreHost(['alpha'])
  assert.equal(catalog.resultTokens(agent), 0)

  ctx.emit('tools/result', { agent }, { content, isError: false })
  const once = catalog.resultTokens(agent)
  assert.equal(once, estimateTokens(content))
  assert.ok(once > 0)

  ctx.emit('tools/result', { agent }, { content, isError: false })
  assert.equal(catalog.resultTokens(agent), once * 2)
})

test('resultTokens is per agent, ignores calls without an agent and never mutates results', () => {
  const { ctx, agent, otherAgent, catalog } = coreHost(['alpha'])
  const result = { content, isError: false }
  const snapshot = JSON.stringify(result)

  ctx.emit('tools/result', { agent }, result)
  assert.equal(catalog.resultTokens(otherAgent), 0)
  assert.equal(JSON.stringify(result), snapshot)

  ctx.emit('tools/result', {}, { content, isError: false })
  assert.equal(catalog.resultTokens(agent), estimateTokens(content))
  assert.equal(catalog.resultTokens(otherAgent), 0)

  ctx.emit('tools/result', { agent: otherAgent }, { content, isError: false })
  assert.equal(catalog.resultTokens(otherAgent), estimateTokens(content))
  assert.equal(catalog.resultTokens(agent), estimateTokens(content))
})

test('schema metering is unaffected by result metering', () => {
  const { ctx, agent, catalog } = coreHost(['alpha', 'beta'])
  const fresh = catalog.wireTokens(agent)
  ctx.emit('tools/result', { agent }, { content, isError: false })
  assert.equal(catalog.wireTokens(agent), fresh)
})