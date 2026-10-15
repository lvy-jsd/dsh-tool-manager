import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVisibilityController } from '../../packages/dsh-tool-manager/lib/visibility.js'

// A host with several live agents: the panel's Sessions view asks for each
// agent's parent. Regression: the core used to read `ctx.agents` there, which
// the plugin ctx does not inject, so the view threw once a second agent existed.
test('parentOf resolves subagents through the injected agents API', () => {
  const parent = { id: 'p', options: {} }
  const child = { id: 'c', options: {} }
  const other = { id: 'o', options: {} }
  const ctx = {
    tools: { schemas: () => [], restrict: () => () => {} },
    get agents() { throw new Error('cannot get property "agents" without inject') },
  }
  const vis = createVisibilityController(ctx, { pinned: () => new Set(), getCatalog: () => null })
  const agentCtx = {
    agents: {
      list: () => [parent, child, other],
      isOwnedBy: (id, candidate) => id === 'c' && candidate === parent,
      get: () => undefined,
    },
    on: () => () => {},
  }
  vis.mount(agentCtx)
  assert.deepEqual(vis.agents().map((a) => a.id), ['p', 'c', 'o'])
  assert.equal(vis.parentOf(child), parent)
  assert.equal(vis.parentOf(parent), undefined)
  assert.equal(vis.parentOf(other), undefined)
})
