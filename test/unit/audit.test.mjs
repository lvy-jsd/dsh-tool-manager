import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coreHost } from './panel-core-host.mjs'

test('audit records loads, unloads and pause changes newest-first, emits events and returns detached entries', async (t) => {
  const { catalog, agent, events } = coreHost(t)
  assert.deepEqual(catalog.audit(), [])
  await catalog.load(agent, ['alpha_tool'])
  await catalog.unload(agent, ['alpha_tool'])
  catalog.updateConfig({ paused: true })
  await catalog.load(agent, ['beta_tool'])
  assert.deepEqual(catalog.audit().map(({ kind, ok }) => ({ kind, ok })), [
    { kind: 'paused', ok: false }, { kind: 'config', ok: true }, { kind: 'unload', ok: true }, { kind: 'load', ok: true },
  ])
  for (const row of catalog.audit()) assert.ok(Number.isFinite(row.at))
  assert.equal(events.filter(({ event }) => event === 'tool-catalog/audit').length, 4)
  const rows = catalog.audit()
  rows[0].summary = 'tampered'
  rows.pop()
  assert.equal(catalog.audit().length, 4)
  assert.notEqual(catalog.audit()[0].summary, 'tampered')
  catalog.updateConfig({ paused: true })
  assert.equal(catalog.audit().length, 4, 'no event for an unchanged pause value')
})

test('audit keeps the last 200 entries; the 201st drops the oldest; clearAudit empties and notifies', async (t) => {
  const { catalog, agent, events } = coreHost(t)
  for (let i = 0; i < 201; i++) await catalog.load(agent, [`missing-${i}`])
  const rows = catalog.audit()
  assert.equal(rows.length, 200)
  assert.equal(rows[0].summary, 'missing-200')
  assert.equal(rows.at(-1).summary, 'missing-1')
  assert.equal(events.filter(({ event }) => event === 'tool-catalog/audit').length, 201)
  catalog.clearAudit()
  assert.deepEqual(catalog.audit(), [])
  assert.equal(events.at(-1).event, 'tool-catalog/audit')
})

test('audit is process-local; another core starts empty and result tokens are independent', async (t) => {
  const { catalog, agent, ctx } = coreHost(t)
  await catalog.load(agent, ['alpha_tool'])
  ctx.emit('tools/result', { agent }, { content: [{ type: 'text', text: 'result data' }] })
  const tokens = catalog.resultTokens(agent)
  assert.ok(tokens > 0)
  catalog.clearAudit()
  assert.equal(catalog.resultTokens(agent), tokens)
  assert.deepEqual(coreHost(t).catalog.audit(), [])
})
