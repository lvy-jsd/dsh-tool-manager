import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coreHost } from './panel-core-host.mjs'
import { toolsUnder } from '../../packages/dsh-tool-ultra-core/lib/catalog.js'
import { apply as applyBridge } from '../../packages/dsh-tool-ultra-capability-bridge/lib/index.js'
import { apply as applyDevices } from '../../packages/dsh-tool-ultra-devices/lib/index.js'

// Reuse the live core/agent fixture used by the panel tests. Install the real
// plugins after core, in reverse namespace order to exercise fixed priority.
function setup(t) {
  const host = coreHost(t)
  const { ctx, catalog, agent } = host
  for (const name of ['web_read', 'web_links', 'gamma_tool', 'device__laptop__shell_run', 'device__pixel__screen_capture', 'device__shared__files_read']) {
    ctx.tools.register({ name, description: name, parameters: {} })
  }
  ctx.effect(() => catalog.registerToolPack({ id: 'web', tools: ['web_read', 'web_links'] }))
  const pluginCtx = { ...ctx, toolCatalog: catalog }
  applyDevices(pluginCtx, { devices: {
    list: () => [{ slug: 'laptop' }, { slug: 'pixel' }, { slug: 'shared' }],
    currentFor: (id) => id === agent.id ? 'laptop' : 'pixel',
  } })
  const capabilities = applyBridge(pluginCtx, { packs: {
    editing: ['alpha_tool', 'beta_tool'],
    web: ['gamma_tool'],
    shared: ['beta_tool'],
    workstation: ['device:current', 'pack:web'],
    empty: [],
  } })
  const namesOf = (target, caller = agent) => toolsUnder(catalog.get(caller), catalog.resolve(target, caller)).map((tool) => tool.name).sort()
  const loaded = () => [...catalog.stateOf(agent).loaded].sort()
  return { ...host, capabilities, namesOf, loaded }
}

test('bare web loads the real web pack and unloads through the same entry', async (t) => {
  const { execute, namesOf, loaded } = setup(t)
  assert.deepEqual(namesOf('web'), ['web_links', 'web_read'])
  await execute('tools_load', { targets: ['web'] })
  assert.deepEqual(loaded(), ['web_links', 'web_read'])
  await execute('tools_unload', { targets: ['web'] })
  assert.deepEqual(loaded(), [])
})

for (const [target, expected] of [
  ['pack:web', ['web_links', 'web_read']],
  ['cap:editing', ['alpha_tool', 'beta_tool']],
  ['device:current', ['device__laptop__shell_run']],
  ['device:all', ['device__laptop__shell_run', 'device__pixel__screen_capture', 'device__shared__files_read']],
  ['device:pixel/screen_capture', ['device__pixel__screen_capture']],
  ['cap:workstation', ['device__laptop__shell_run', 'web_links', 'web_read']],
]) {
  test(`explicit ${target} keeps its existing expansion and load result`, async (t) => {
    const { execute, namesOf, loaded } = setup(t)
    assert.deepEqual(namesOf(target), expected)
    await execute('tools_load', { targets: [target] })
    assert.deepEqual(loaded(), expected)
  })
}

test('a capability-only name loads its exact tools without group siblings', async (t) => {
  const { execute, namesOf, loaded } = setup(t)
  assert.deepEqual(namesOf('editing'), ['alpha_tool', 'beta_tool'])
  await execute('tools_load', { targets: ['editing'] })
  assert.deepEqual(loaded(), ['alpha_tool', 'beta_tool'])
})

test('a device-only name and current resolve through the calling session', async (t) => {
  const { catalog, agent, execute, namesOf, loaded } = setup(t)
  assert.deepEqual(namesOf('pixel'), ['device__pixel__screen_capture'])
  assert.deepEqual(namesOf('current'), ['device__laptop__shell_run'])
  assert.deepEqual(namesOf('current', { ...agent, id: 'another-session' }), ['device__pixel__screen_capture'])
  await execute('tools_load', { targets: ['current'] })
  assert.deepEqual(loaded(), ['device__laptop__shell_run'])
  assert.equal(catalog.resolve('device:missing').kind, 'missing')
})

test('unknown names stay missing and report a skipped load, including empty packs', async (t) => {
  const { catalog, execute, loaded } = setup(t)
  for (const target of ['does-not-exist', 'empty', 'pack:missing', 'cap:missing', 'device:missing']) {
    assert.equal(catalog.resolve(target).kind, 'missing')
    const result = await execute('tools_load', { targets: [target] })
    assert.match(result, /not found/)
    assert.deepEqual(loaded(), [])
  }
})

test('paths and explicit prefixes never enter bare-name probing', async (t) => {
  const { catalog, ctx, execute } = setup(t)
  const probes = []
  ctx.effect(() => catalog.registerTargetResolver({
    prefix: 'cap:',
    resolve: (target) => { probes.push(target); return ['gamma_tool'] },
  }))
  assert.equal(catalog.resolve('uncategorized/misc').kind, 'group')
  await execute('tools_load', { targets: ['uncategorized/misc'] })
  assert.equal(catalog.resolve('/no/such/path').kind, 'missing')
  assert.equal(catalog.resolve('other:editing').kind, 'missing')
  assert.deepEqual(probes, [])
})

test('ordinary categories, groups, exact and short tool names retain their fallback', (t) => {
  const { catalog, ctx } = setup(t)
  ctx.tools.register({ name: 'mcp__demo__lookup', description: 'lookup', parameters: {} })
  assert.equal(catalog.resolve('uncategorized').kind, 'category')
  assert.equal(catalog.resolve('misc').kind, 'group')
  assert.equal(catalog.resolve('alpha_tool').tool.name, 'alpha_tool')
  assert.equal(catalog.resolve('lookup').tool.name, 'mcp__demo__lookup')
  assert.equal(catalog.resolve('read').kind, 'missing', 'pinned tools stay outside the catalog')
})

test('collisions stop at pack, then cap, regardless of plugin registration order', async (t) => {
  const { catalog, ctx, execute, namesOf, loaded } = setup(t)
  ctx.effect(() => catalog.registerToolPack({ id: 'shared', tools: ['alpha_tool'] }))
  assert.deepEqual(namesOf('shared'), ['alpha_tool'])
  await execute('tools_load', { targets: ['shared'] })
  assert.deepEqual(loaded(), ['alpha_tool'], 'must not merge cap or device tools')
  assert.deepEqual(namesOf('cap:shared'), ['beta_tool'])
  assert.deepEqual(namesOf('device:shared'), ['device__shared__files_read'])
  // device: was registered before cap:, but cap: still wins without a pack.
  assert.deepEqual(namesOf('laptop'), ['device__laptop__shell_run'])
  ctx.effect(() => catalog.registerTargetResolver({ prefix: 'cap:', resolve: (target) => target === 'cap:laptop' ? ['beta_tool'] : undefined }))
  assert.deepEqual(namesOf('laptop'), ['beta_tool'])
})

test('fallback runs after late plugin resolvers and sees registration/disposal live', (t) => {
  const { catalog, ctx, capabilities, namesOf } = setup(t)
  const removePack = catalog.registerToolPack({ id: 'later', tools: ['alpha_tool'] })
  const removeCap = capabilities.registerPack('later', ['beta_tool'])
  assert.deepEqual(namesOf('later'), ['alpha_tool'])
  removePack()
  assert.deepEqual(namesOf('later'), ['beta_tool'])
  removeCap()
  assert.equal(catalog.resolve('later').kind, 'missing')
  ctx.effect(() => catalog.registerTargetResolver({ resolve: (target) => target === 'web' ? ['beta_tool'] : undefined }))
  assert.deepEqual(namesOf('web'), ['beta_tool'], 'registered catch-all precedes core fallback')
})

test('aliases keep their original interpretation even when a namespace shares a tool name', async (t) => {
  const { catalog, ctx, capabilities, execute, namesOf, loaded } = setup(t)
  capabilities.registerPack('alpha_tool', ['gamma_tool'])
  capabilities.registerPack('web_read', ['gamma_tool'])
  ctx.tools.register({ name: 'single', description: 'single', parameters: {} })
  ctx.effect(() => catalog.registerToolPack({ id: 'single', tools: ['single'] }))
  capabilities.registerPack('self', ['beta_tool'])
  capabilities.registerPack('beta_tool', ['beta_tool'])
  assert.deepEqual(namesOf('cap:editing'), ['alpha_tool', 'beta_tool'])
  assert.deepEqual(namesOf('editing'), ['alpha_tool', 'beta_tool'])
  assert.deepEqual(namesOf('pack:web'), ['web_links', 'web_read'])
  assert.deepEqual(namesOf('web'), ['web_links', 'web_read'])
  assert.deepEqual(namesOf('self'), ['beta_tool'])
  assert.deepEqual(namesOf('beta_tool'), ['beta_tool'], 'a self-named tool alias must not recurse')
  assert.deepEqual(namesOf('single'), ['single'], 'a self-named native pack must not recurse')
  await execute('tools_load', { targets: ['cap:editing'] })
  assert.deepEqual(loaded(), ['alpha_tool', 'beta_tool'])
})

test('a failing namespace resolver passes to the next namespace', (t) => {
  const { catalog, ctx, capabilities, namesOf } = setup(t)
  ctx.effect(() => catalog.registerTargetResolver({ prefix: 'pack:', resolve: () => { throw new Error('offline') } }))
  capabilities.registerPack('available', ['alpha_tool'])
  assert.deepEqual(namesOf('available'), ['alpha_tool'])
})

test('stale aliases cannot break working directory names or silently load an empty set', async (t) => {
  const { catalog, capabilities, execute, loaded } = setup(t)
  capabilities.registerPack('misc', ['no-such-tool'])
  capabilities.registerPack('broken', ['no-such-tool', 'another-missing-tool'])
  assert.equal(catalog.resolve('misc').kind, 'group')
  assert.equal(catalog.resolve('broken').kind, 'missing')
  assert.match(await execute('tools_load', { targets: ['broken'] }), /not found/)
  assert.deepEqual(loaded(), [])
  // Explicit aliases retain even their old empty synthetic-category behavior.
  assert.equal(catalog.resolve('cap:broken').kind, 'category')
})
