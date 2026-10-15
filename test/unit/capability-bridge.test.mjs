import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCatalog, resolveTarget, toolsUnder } from '../../packages/dsh-tool-manager/lib/catalog.js'
import { apply as applyBridge, PREFIX, name as bridgeName } from '../../packages/dsh-tool-manager-capability-bridge/lib/index.js'

const schemas = [
  'adb_install', 'adb_logcat', 'phone_tap', 'gh_get_file', 'merge_pull_request',
].map((name) => ({ name, description: `${name} does something useful.` }))
const catalog = buildCatalog(schemas)

/** Minimal ctx capturing the resolver and category the bridge registers. */
function makeCtx() {
  const resolvers = []
  const categories = []
  const services = new Map()
  const ctx = {
    logger: () => ({ warn() {}, info() {} }),
    effect: (fn) => fn(),
    provide: (name, value) => services.set(name, value),
    get: (name) => services.get(name),
    toolCatalog: {
      registerTargetResolver: (r) => { resolvers.push(r); return () => resolvers.splice(resolvers.indexOf(r), 1) },
      defineCategory: (n, d) => { categories.push([n, d]); return () => {} },
      refresh() {},
    },
  }
  return { ctx, resolvers, categories, services }
}

const resolverOf = (resolvers) => resolvers[0]

// --- resolver registration ----------------------------------------------------
test('bridge: registers one prefix resolver and a capabilities category', () => {
  const { ctx, resolvers, categories } = makeCtx()
  applyBridge(ctx, { packs: { dev: ['/uncategorized'] } })
  assert.equal(resolvers.length, 1)
  assert.equal(resolverOf(resolvers).prefix, PREFIX)
  assert.equal(resolverOf(resolvers).name, bridgeName)
  assert.equal(categories[0][0], 'capabilities')
})

test('bridge: enabled:false registers nothing', () => {
  const { ctx, resolvers, categories } = makeCtx()
  applyBridge(ctx, { enabled: false })
  assert.equal(resolvers.length, 0)
  assert.equal(categories.length, 0)
})

test('bridge: the prefix is configurable, and the category can be skipped', () => {
  const { ctx, resolvers, categories } = makeCtx()
  applyBridge(ctx, { prefix: 'pack:', listInDirectory: false, packs: { a: ['adb_install'] } })
  assert.equal(resolverOf(resolvers).prefix, 'pack:')
  assert.equal(categories.length, 0)
})

// --- resolution ---------------------------------------------------------------
test('bridge: an unknown pack falls through to a normal lookup', () => {
  const { ctx, resolvers } = makeCtx()
  applyBridge(ctx, { packs: { known: ['adb_install'] } })
  assert.equal(resolverOf(resolvers).resolve('cap:unknown'), undefined)
})

test('bridge: a pack expands to its targets, and tools_load can use the alias', () => {
  const { ctx, resolvers } = makeCtx()
  applyBridge(ctx, { packs: { android: ['/uncategorized', 'gh_get_file'] } })
  const resolver = resolverOf(resolvers)
  assert.deepEqual(resolver.resolve('cap:android'), ['/uncategorized', 'gh_get_file'])

  // One target in a pack: the alias is that node.
  const single = makeCtx()
  applyBridge(single.ctx, { packs: { one: ['adb_install'] } })
  const node = resolveTarget(catalog, 'cap:one', single.resolvers)
  assert.equal(node.kind, 'tool')
  assert.equal(node.tool.name, 'adb_install')
})

test('bridge: a pack of several targets resolves as one synthetic node', () => {
  const { ctx, resolvers } = makeCtx()
  applyBridge(ctx, { packs: { two: ['adb_install', 'gh_get_file'] } })
  const node = resolveTarget(catalog, 'cap:two', resolvers)
  assert.equal(node.kind, 'category')
  const names = toolsUnder(catalog, node).map((tool) => tool.name).sort()
  assert.deepEqual(names, ['adb_install', 'gh_get_file'])
})

test('bridge: a group path in a pack brings the whole group', () => {
  const { ctx, resolvers } = makeCtx()
  applyBridge(ctx, { packs: { devs: ['adb'] } })
  const node = resolveTarget(catalog, 'cap:devs', resolvers)
  const names = toolsUnder(catalog, node).map((tool) => tool.name).sort()
  assert.deepEqual(names, ['adb_install', 'adb_logcat'])
})

test('bridge: an empty pack resolves to nothing, not to the whole tree', () => {
  const { ctx, resolvers } = makeCtx()
  applyBridge(ctx, { packs: { empty: [] } })
  const node = resolveTarget(catalog, 'cap:empty', resolvers)
  assert.equal(node.kind, 'missing')
})

test('bridge: a pack of several targets keeps its tools grouped by their own group', () => {
  const { ctx, resolvers } = makeCtx()
  applyBridge(ctx, { packs: { mixed: ['adb_install', 'phone_tap', 'gh_get_file'] } })
  const node = resolveTarget(catalog, 'cap:mixed', resolvers)
  assert.equal(node.kind, 'category')
  // 'adb' is a real group (two tools share the prefix); single-occurrence
  // prefixes fall back to the core's structural 'misc' group.
  assert.deepEqual(node.category.groups.map((g) => g.name).sort(), ['adb', 'misc'])
  const names = toolsUnder(catalog, node).map((tool) => tool.name).sort()
  assert.deepEqual(names, ['adb_install', 'gh_get_file', 'phone_tap'])
})

test('bridge: without the bridge installed, cap: is just an unknown target', () => {
  const node = resolveTarget(catalog, 'cap:anything')
  assert.equal(node.kind, 'missing')
})

// --- runtime registration -----------------------------------------------------
test('bridge: a pack can be registered at runtime and removed again', () => {
  const { ctx, resolvers } = makeCtx()
  const api = applyBridge(ctx, { packs: {} })
  assert.deepEqual(api.names(), [])
  const dispose = api.registerPack('later', ['adb_install'])
  assert.deepEqual(api.packs(), { later: ['adb_install'] })
  assert.equal(resolveTarget(catalog, 'cap:later', resolvers).tool.name, 'adb_install')
  dispose()
  assert.deepEqual(api.names(), [])
  assert.equal(resolveTarget(catalog, 'cap:later', resolvers).kind, 'missing')
})

test('bridge: a string pack declaration is accepted as one target', () => {
  const { ctx } = makeCtx()
  const api = applyBridge(ctx, { packs: { solo: 'adb_install' } })
  assert.deepEqual(api.packs(), { solo: ['adb_install'] })
})

test('bridge: refresh is called when packs change, so the directory follows', () => {
  const { ctx } = makeCtx()
  let refreshes = 0
  ctx.toolCatalog.refresh = () => { refreshes += 1 }
  const api = applyBridge(ctx, { packs: {} })
  const dispose = api.registerPack('a', ['adb_install'])
  assert.equal(refreshes, 1)
  dispose()
  assert.equal(refreshes, 2)
})

test('bridge: the service exposes the packs for other plugins', () => {
  const { ctx, services } = makeCtx()
  applyBridge(ctx, { packs: { dev: ['adb_install'] } })
  const service = services.get('toolCapabilityPacks')
  assert.equal(service.prefix, PREFIX)
  assert.deepEqual(service.names(), ['dev'])
})

test('bridge: an alias exposes exactly its tools, so loading cannot leak siblings', () => {
  const { ctx, resolvers } = makeCtx()
  // Two tools that each live in a group with an unlisted sibling.
  applyBridge(ctx, { packs: { pair: ['adb_install', 'gh_get_file'] } })
  const node = resolveTarget(catalog, 'cap:pair', resolvers)
  assert.equal(node.kind, 'category')
  // The alias carries the exact tool list; the load path uses it instead of
  // subscribing to group names, which would drag in adb_logcat and
  // merge_pull_request.
  assert.deepEqual(node.category.aliasTools.map((t) => t.name), ['adb_install', 'gh_get_file'])
  assert.deepEqual(toolsUnder(catalog, node).map((t) => t.name).sort(), ['adb_install', 'gh_get_file'])
})

test('bridge: a high-risk tool inside a pack keeps its own name after expansion', () => {
  const { ctx, resolvers } = makeCtx()
  applyBridge(ctx, { packs: { risky: ['merge_pull_request'] } })
  const node = resolveTarget(catalog, 'cap:risky', resolvers)
  // The alias becomes the tool itself, so the risk gate sees the real name.
  assert.equal(node.kind, 'tool')
  assert.equal(node.tool.name, 'merge_pull_request')
})
