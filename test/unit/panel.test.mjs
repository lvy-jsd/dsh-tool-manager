import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { isTrustedWebRequest, createApi, mountWebRoutes } from '../../packages/dsh-tool-manager-panel/lib/index.js'

// --- trust fence --------------------------------------------------------------
const req = (headers) => ({ headers })

test('fence: loopback with no origin is trusted', () => {
  assert.equal(isTrustedWebRequest(req({ host: '127.0.0.1:3080' })), true)
  assert.equal(isTrustedWebRequest(req({ host: 'localhost:3080' })), true)
})

test('fence: a non-loopback host is refused unless declared', () => {
  assert.equal(isTrustedWebRequest(req({ host: 'evil.example:3080' })), false)
  assert.equal(isTrustedWebRequest(req({ host: 'evil.example:3080' }), ['evil.example:3080']), true)
})

test('fence: cross-site and mismatched origin are refused', () => {
  assert.equal(isTrustedWebRequest(req({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(isTrustedWebRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' })), false)
  assert.equal(isTrustedWebRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' })), true)
})

test('fence: a missing host header is refused', () => {
  assert.equal(isTrustedWebRequest(req({})), false)
})

// --- API surface --------------------------------------------------------------
/** Minimal catalog stub mirroring the toolCatalog service. */
function makeCatalog() {
  const tools = [
    { name: 'adb_install', short: 'install', summary: 'Install an APK.', tokens: 120, highRisk: false, category: 'device', group: 'adb' },
    { name: 'merge_pull_request', short: 'merge_pull_request', summary: 'Merge a PR.', tokens: 300, highRisk: true, category: 'code', group: 'github' },
  ]
  const byName = new Map(tools.map((t) => [t.name, t]))
  const groups = new Map([['adb', { name: 'adb', category: 'device', tools: [tools[0]] }], ['github', { name: 'github', category: 'code', tools: [tools[1]] }]])
  const categories = new Map([
    ['device', { name: 'device', description: 'Devices', groups: [groups.get('adb')] }],
    ['code', { name: 'code', description: 'Code hosts', groups: [groups.get('github')] }],
  ])
  const catalog = { tools: byName, groups, categories }
  const agent = { id: 'sess-1' }
  const state = { loaded: new Set(['adb_install']), groups: new Set(['adb']), handoffGroups: new Set(), handoffTools: new Set() }
  const service = {
    get: () => catalog,
    resolve: (target) => {
      const raw = String(target)
      if (raw === '/' || raw === '') return { kind: 'root' }
      const tool = byName.get(raw)
      if (tool) return { kind: 'tool', tool }
      // Paths are "/<category>" or "/<category>/<group>"; names are bare.
      const parts = raw.split('/').filter(Boolean)
      if (parts.length === 1) {
        const category = categories.get(parts[0])
        if (category) return { kind: 'category', category }
      }
      if (parts.length === 2) {
        const group = groups.get(parts[1])
        if (group) return { kind: 'group', group }
      }
      const group = groups.get(raw)
      if (group) return { kind: 'group', group }
      return { kind: 'missing', target: raw }
    },
    agents: () => [{ agent, id: 'sess-1', parentId: null }],
    stateOf: () => state,
    allowFor: () => ['tools_ls', 'tools_load', 'adb_install'],
    wireTokens: () => 1234,
    load: async (a, targets) => `Loaded ${targets.length} target(s)`,
    unload: async (a, targets) => `Unloaded ${targets.length} target(s)`,
    config: () => ({
      pinned: ['bash'], entryTools: ['tools_ls'], extraPinned: [], unpinned: [], highRisk: [],
      exemptProviders: ['claude-code'], defaults: ['bash'], settingsFile: '/tmp/dsh/tool-manager/config.json', hasSettings: false,
    }),
    updateConfig: (patch) => ({
      pinned: ['bash', ...(patch.pinned ?? [])], entryTools: ['tools_ls'],
      extraPinned: patch.pinned ?? [], unpinned: patch.unpin ?? [], highRisk: patch.highRisk ?? [],
      exemptProviders: [], defaults: ['bash'], settingsFile: '/tmp/dsh/tool-manager/config.json', hasSettings: true,
    }),
    reloadConfig: () => ({ pinned: [], entryTools: [], extraPinned: [], unpinned: [], highRisk: [], exemptProviders: [], defaults: [], settingsFile: '/tmp/dsh/tool-manager/config.json', hasSettings: false }),
    extensions: () => ({ classifiers: [{ name: 'rules:defaults', priority: 100 }], filters: ['testkit'], annotations: [], categories: ['device', 'code'], riskGates: ['risk-gate'], stateProviders: ['persist'] }),
    find: () => [{ ...tools[0], path: '/device/adb/install' }],
  }
  return service
}

test('api: tree renders every level with the same node shape', () => {
  const api = createApi(makeCatalog())
  const root = api.tree({ path: '/' }).root
  assert.equal(root.kind, 'root')
  assert.equal(root.children.length, 2)
  assert.equal(root.toolCount, 2)
  assert.equal(root.tokens, 420)

  const category = api.tree({ path: '/device' }).root
  assert.equal(category.kind, 'category')
  assert.deepEqual(category.children.map((c) => c.name), ['adb'])

  const group = api.tree({ path: '/device/adb' }).root
  assert.equal(group.children[0].kind, 'tool')
  assert.equal(group.children[0].name, 'adb_install')
  assert.equal(group.children[0].highRisk, false)

  const tool = api.tree({ path: 'adb_install' }).root
  assert.equal(tool.kind, 'tool')
  assert.equal(tool.toolCount, 1)
})

test('api: a missing path is reported, not thrown', () => {
  const api = createApi(makeCatalog())
  assert.equal(api.tree({ path: '/nope' }).root.kind, 'missing')
})

test('api: sessions report loaded state and real token usage', () => {
  const api = createApi(makeCatalog())
  const [session] = api.sessions().sessions
  assert.equal(session.id, 'sess-1')
  assert.deepEqual(session.groups, ['adb'])
  assert.deepEqual(session.loadedTools, ['adb_install'])
  assert.equal(session.visible, 3)
  assert.equal(session.wireTokens, 1234)
})

test('api: an exempt session is flagged instead of showing 0 visible tools', () => {
  const catalog = makeCatalog()
  const api = createApi({ ...catalog, isExempt: () => true, allowFor: () => null })
  const [session] = api.sessions().sessions
  assert.equal(session.exempt, true)
  assert.equal(session.visible, null)
  const [normal] = createApi(catalog).sessions().sessions
  assert.equal(normal.exempt, false)
})

test('api: load and unload go through the core and report its message', async () => {
  const api = createApi(makeCatalog())
  assert.equal((await api.load({ sessionId: 'sess-1', targets: ['/device/adb'] })).message, 'Loaded 1 target(s)')
  assert.equal((await api.unload({ sessionId: 'sess-1', targets: ['adb_install'] })).message, 'Unloaded 1 target(s)')
})

test('api: an unknown session is an error result, not a crash', async () => {
  const api = createApi(makeCatalog())
  const result = await api.load({ sessionId: 'nope', targets: ['/device'] })
  assert.equal(result.ok, false)
  assert.match(result.message, /no live session/)
})

test('api: search returns a results array, not a text blob', () => {
  const api = createApi(makeCatalog())
  const { results } = api.search({ query: 'adb' })
  assert.ok(Array.isArray(results))
  assert.equal(results[0].name, 'adb_install')
})

test('api: extensions are listed for the Extensions view', () => {
  const api = createApi(makeCatalog())
  const ext = api.extensions()
  assert.equal(ext.classifiers[0].name, 'rules:defaults')
  assert.equal(ext.classifiers[0].priority, 100)
  assert.deepEqual(ext.riskGates, ['risk-gate'])
})

test('api: config reports the settings file and is editable', () => {
  const body = createApi(makeCatalog()).config()
  assert.equal(body.editable, true)
  assert.equal(body.config.settingsFile, '/tmp/dsh/tool-manager/config.json')
  assert.equal(body.config.hasSettings, false)
  assert.deepEqual(body.config.extraPinned, [])
  assert.deepEqual(body.config.entryTools, ['tools_ls'])
})

test('api: updateConfig returns the new effective configuration', () => {
  const body = createApi(makeCatalog()).updateConfig({ settings: { pinned: ['adb_install'] } })
  assert.deepEqual(body.config.extraPinned, ['adb_install'])
  assert.equal(body.config.hasSettings, true)
  assert.match(body.config.settingsFile, /config\.json$/)
})

test('api: updateConfig is reachable through the whitelist', async () => {
  const routes = []
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    on: () => () => {},
    logger: () => ({ warn() {}, info() {} }),
  }
  const dispose = mountWebRoutes(ctx, makeCatalog())
  const server = createServer((req, res) => routes[0].handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const call = async (method, params) => (await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })).json()
    const saved = await call('updateConfig', { settings: { highRisk: ['merge_pull_request'] } })
    assert.equal(saved.ok, true)
    assert.deepEqual(saved.config.highRisk, ['merge_pull_request'])
    const reloaded = await call('reloadConfig', {})
    assert.equal(reloaded.ok, true)
    assert.deepEqual(reloaded.config.highRisk, [])
    // An unknown method stays a 400, not a silent no-op.
    const unknown = await call('updateEverything', {})
    assert.equal(unknown.ok, false)
  } finally {
    dispose()
    await new Promise((resolve) => server.close(resolve))
  }
})

// --- route mounting -----------------------------------------------------------
function makeWebCtx() {
  const routes = []
  const listeners = new Map()
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: { register: (route) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } } },
    on: (event, handler) => { listeners.set(event, handler); return () => listeners.delete(event) },
    effect: (fn) => fn(),
    inject: (deps, fn) => fn(ctx),
    logger: () => ({ warn() {}, info() {} }),
  }
  return { ctx, routes, listeners }
}

test('routes: api and events are mounted under the same prefix', () => {
  const { ctx, routes } = makeWebCtx()
  mountWebRoutes(ctx, makeCatalog())
  assert.deepEqual(routes.map((r) => r.path), ['/tool-manager/api', '/tool-manager/events'])
  assert.ok(routes.every((r) => r.kind === 'prefix' && typeof r.handler === 'function'))
})

test('routes: unmounting removes both', () => {
  const { ctx, routes } = makeWebCtx()
  const dispose = mountWebRoutes(ctx, makeCatalog())
  assert.equal(routes.length, 2)
  dispose()
  assert.equal(routes.length, 0)
})

test('plugin: mounts only when a web server exists, and enabled:false skips it', async () => {
  const { default: plugin } = await import('../../packages/dsh-tool-manager-panel/lib/index.js')
  let injected = false
  const base = () => ({ inject: (deps, fn) => { injected = true; fn({ ...makeWebCtx().ctx }) }, logger: () => ({ info() {} }) })
  plugin.apply(base(), {})
  assert.equal(injected, true)
  injected = false
  plugin.apply(base(), { enabled: false })
  assert.equal(injected, false)
})

// --- over real HTTP ------------------------------------------------------------
// The unit tests above call handlers directly; this serves them through a real
// HTTP server and a real fetch, which is what the browser does.
test('http: api and events answer over a real socket behind the fence', async () => {
  const routes = []
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    on: () => () => {},
    logger: () => ({ warn() {}, info() {} }),
  }
  const dispose = mountWebRoutes(ctx, makeCatalog())
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const route = routes.find((r) => path === r.path || path.startsWith(r.path + '/'))
    if (!route) {
      res.writeHead(404)
      res.end()
      return
    }
    route.handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const api = await fetch(`${base}/tool-manager/api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'tree', params: { path: '/' } }),
    })
    assert.equal(api.status, 200)
    const body = await api.json()
    assert.equal(body.ok, true)
    assert.equal(body.root.kind, 'root')

    // A GET on the api route is a method error, not a crash.
    const wrongMethod = await fetch(`${base}/tool-manager/api`)
    assert.equal(wrongMethod.status, 405)

    // The static page is gone: the panel renders natively in Settings.
    const gone = await fetch(`${base}/tool-manager/ui/`)
    assert.equal(gone.status, 404)

    // The SSE route streams and ends when the client disconnects.
    const controller = new AbortController()
    const events = await fetch(`${base}/tool-manager/events`, { signal: controller.signal })
    assert.equal(events.status, 200)
    const reader = events.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    assert.match(first, /event: ready/)
    controller.abort()
  } finally {
    dispose()
    await new Promise((resolve) => server.close(resolve))
  }
})
