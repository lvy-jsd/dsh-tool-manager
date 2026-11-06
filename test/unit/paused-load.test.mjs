import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { coreHost } from './panel-core-host.mjs'

const reason = /tool loading is paused; turn it back on in the tool panel/

test('paused load refuses before hooks, records a failed audit entry, and resumes after unpausing', async (t) => {
  const { catalog, agent, on } = coreHost(t)
  let hooks = 0
  on('tool-catalog/before-load', () => { hooks++ })
  const initial = catalog.wireTokens(agent)
  assert.equal(catalog.updateConfig({ paused: true }).paused, true)
  const result = await catalog.load(agent, ['alpha_tool'])
  assert.equal(result.ok, false)
  assert.match(result.message, reason)
  assert.equal(hooks, 0)
  assert.equal(catalog.stateOf(agent).loaded.size, 0)
  assert.equal(catalog.wireTokens(agent), initial)
  assert.deepEqual(catalog.audit()[0], { at: catalog.audit()[0].at, kind: 'paused', agentId: agent.id, summary: 'paused loading: alpha_tool', ok: false })
  assert.equal(catalog.updateConfig({ paused: false }).paused, false)
  assert.match(await catalog.load(agent, ['alpha_tool']), /Loaded 1 tool/)
  assert.equal(hooks, 1)
  assert.equal(catalog.stateOf(agent).loaded.has('alpha_tool'), true)
})

test('pause preserves loaded execution, pinned tools and unloading, but stops hidden-call rescue', async (t) => {
  const { catalog, agent, on, preExecute } = coreHost(t)
  await catalog.load(agent, ['alpha_tool'])
  const visible = catalog.allowFor(agent)
  catalog.updateConfig({ paused: true })
  assert.deepEqual(catalog.allowFor(agent), visible)
  let hooks = 0
  on('tool-catalog/before-load', () => { hooks++ })
  assert.deepEqual(await preExecute('alpha_tool'), { kind: 'allow' })
  assert.deepEqual(await preExecute('read'), { kind: 'allow' })
  const refused = await preExecute('beta_tool')
  assert.equal(refused.kind, 'deny')
  assert.match(refused.reason, reason)
  assert.equal(hooks, 0)
  assert.equal(catalog.stateOf(agent).loaded.has('beta_tool'), false)
  assert.match(await catalog.unload(agent, ['alpha_tool']), /Unloaded 1 tool/)
})

test('tools_load renders a paused refusal as model-facing text and reloadConfig sees external pause changes', async (t) => {
  const { catalog, execute, settingsFile } = coreHost(t)
  writeFileSync(settingsFile, JSON.stringify({ paused: true }))
  assert.equal(catalog.reloadConfig().paused, true)
  assert.match(await execute('tools_load', { targets: ['alpha_tool'] }), reason)
  writeFileSync(settingsFile, JSON.stringify({ paused: false }))
  assert.equal(catalog.reloadConfig().paused, false)
  assert.match(await execute('tools_load', { targets: ['alpha_tool'] }), /Loaded 1 tool/)
})

test('pause keeps group-loaded tools callable without running load hooks', async (t) => {
  const { catalog, agent, on, preExecute } = coreHost(t)
  const group = catalog.get().tools.get('alpha_tool').group
  await catalog.load(agent, [group])
  assert.ok(catalog.allowFor(agent).includes('alpha_tool'))
  assert.equal(catalog.stateOf(agent).loaded.has('alpha_tool'), false)
  catalog.updateConfig({ paused: true })
  let hooks = 0
  on('tool-catalog/before-load', () => { hooks++ })
  assert.deepEqual(await preExecute('alpha_tool'), { kind: 'allow' })
  assert.equal(hooks, 0)
})

test('pausing while a load hook awaits prevents the pending load from being applied', async (t) => {
  const { catalog, agent, on } = coreHost(t)
  on('tool-catalog/before-load', () => { catalog.updateConfig({ paused: true }) })
  const refused = await catalog.load(agent, ['alpha_tool'])
  assert.equal(refused.ok, false)
  assert.equal(catalog.stateOf(agent).loaded.has('alpha_tool'), false)
})
