// MCP preset pack: which presets start, which wait for keys, and how they are placed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS, planPresets, describePlan, presetAnnotations, apply } from '../../packages/dsh-tool-ultra-pack-mcp/lib/index.js'

const byId = (plan, id) => plan.find((p) => p.preset.id === id)

test('mcp presets: ids are valid, unique serverNames', () => {
  const ids = PRESETS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,32}$/)
  for (const p of PRESETS) assert.ok(['device', 'code', 'media', 'maps', 'browser', 'memory', 'collaboration', 'automation', 'connectors', 'search', 'system'].includes(p.category), p.id)
})

test('mcp presets: keyless presets start by default, keyed ones wait', () => {
  const plan = planPresets({}, {})
  for (const id of ['memory', 'thinking', 'context7', 'playwright']) assert.equal(byId(plan, id).status, 'on', id)
  for (const id of ['github', 'searxng', 'brave', 'tavily', 'firecrawl', 'notion', 'amap', 'filesystem']) assert.equal(byId(plan, id).status, 'needs-key', id)
  assert.deepEqual(byId(plan, 'playwright').client.args.slice(0, 2), ['-y', '@playwright/mcp@0.0.84'])
  for (const p of plan.filter((p) => p.client?.args)) assert.ok(p.client.args.every((a) => !/@latest$/.test(a)), 'versions are pinned')
})

test('mcp presets: keys from the environment or preset config switch presets on', () => {
  const plan = planPresets({ presets: { brave: { env: { BRAVE_API_KEY: 'cfg-key' } }, filesystem: { roots: ['/srv/work'] } } }, { GITHUB_TOKEN: 'ghp_x', SEARXNG_URL: 'http://127.0.0.1:8888' })
  const gh = byId(plan, 'github')
  assert.equal(gh.status, 'on')
  assert.equal(gh.client.transport, 'streamable-http')
  assert.equal(gh.client.headers.Authorization, 'Bearer ghp_x')
  assert.deepEqual(byId(plan, 'brave').client.env, { BRAVE_API_KEY: 'cfg-key' })
  assert.equal(byId(plan, 'searxng').client.env.SEARXNG_URL, 'http://127.0.0.1:8888')
  assert.equal(byId(plan, 'filesystem').client.args.at(-1), '/srv/work')
  // An optional key upgrades context7 to the hosted endpoint.
  assert.equal(planPresets({}, { CONTEXT7_API_KEY: 'k' }).find((p) => p.preset.id === 'context7').client.transport, 'streamable-http')
})

test('mcp presets: defaults false and enabled false', () => {
  const plan = planPresets({ defaults: false, presets: { memory: { enabled: true } } }, { GITHUB_TOKEN: 'x' })
  assert.equal(byId(plan, 'memory').status, 'on')
  assert.equal(byId(plan, 'github').status, 'off')
  assert.equal(byId(planPresets({ presets: { playwright: { enabled: false } } }, {}), 'playwright').status, 'off')
})

test('mcp presets: status text names what is missing and never prints secrets', () => {
  const text = describePlan(planPresets({}, { GITHUB_TOKEN: 'ghp_secret' }), { context7: 'boom' })
  assert.match(text, /brave \[search\] waiting for BRAVE_API_KEY/)
  assert.match(text, /context7 \[code\] failed: boom/)
  assert.match(text, /github \[code\] on/)
  assert.doesNotMatch(text, /ghp_secret/)
})

test('mcp presets: annotations place groups and mark write tools high risk', () => {
  const ann = presetAnnotations()
  const metaFor = (name) => Object.assign({}, ...ann.filter((a) => a.match.test(name)).map((a) => a.meta))
  assert.deepEqual(metaFor('mcp__github__get_me'), { group: 'github', category: 'code' })
  assert.equal(metaFor('mcp__github__merge_pull_request').risk, 'high')
  assert.equal(metaFor('mcp__filesystem__write_file').risk, 'high')
  assert.equal(metaFor('mcp__filesystem__read_text_file').risk, undefined)
  assert.equal(metaFor('mcp__playwright__browser_evaluate').risk, 'high')
  assert.equal(metaFor('mcp__amap__maps_geo').category, 'maps')
})

test('mcp presets: apply starts one client per running preset and registers mcp_presets', async () => {
  const started = []
  const tools = []
  const ctx = {
    tools: { register: (d) => tools.push(d) },
    plugin: (plugin, cfg) => { started.push([plugin, cfg.serverName]); return Promise.resolve() },
    logger: () => ({ info() {}, warn() {} }),
  }
  const fakeClient = { name: 'mcp-client', apply() {} }
  apply(ctx, { defaults: false, presets: { memory: { enabled: true }, thinking: { enabled: true } } }, async () => ({ default: fakeClient }))
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(started.map((s) => s[1]), ['memory', 'thinking'])
  assert.equal(started[0][0], fakeClient)
  assert.equal(tools.length, 1)
})

test('mcp presets: a missing client module is reported, not thrown', async () => {
  const ctx = { tools: { register() {} }, plugin() { throw new Error('unreachable') }, logger: () => ({ info() {}, warn() {} }) }
  let registered
  ctx.tools.register = (d) => { registered = d }
  apply(ctx, { defaults: false, presets: { memory: { enabled: true } } }, async () => { throw new Error('Cannot find module') })
  await new Promise((r) => setTimeout(r, 10))
  assert.ok(registered)
})
