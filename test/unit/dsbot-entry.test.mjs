import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// Load a hand-written browser module (window.__ModuleLoader__.load({...})) and
// return its factory, without a browser.
function loadFactory(path) {
  let registered
  const window = { __ModuleLoader__: { load: (spec) => { registered = spec } } }
  runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), { window })
  return registered
}

const react = { createElement: () => null, useEffect() {}, useRef: () => ({}), useState: (v) => [v, () => {}], useCallback: (f) => f }
const makeCtx = () => {
  const registrations = []
  const slots = { inject: (_name, fn) => fn(), register: (spec, component) => { registrations.push({ spec, component }); return () => {} } }
  return { registrations, ctx: { get: (name) => (name === 'slots' ? slots : undefined), effect: (fn) => fn() } }
}

test('panel client exports its section component for other entry points', () => {
  const spec = loadFactory('../../packages/dsh-tool-manager-panel/lib/client.js')
  assert.equal(spec.id, '@lvy-jsd/dsh-tool-manager-panel')
  const mod = spec.factory((id) => (id === 'react' ? react : {}))
  assert.equal(typeof mod.ToolManagerSection, 'function')
  assert.equal(mod.NS, 'tool-manager.panel')
})

test('dsbot entry registers one shell overlay with the panel dictionaries', () => {
  const panel = loadFactory('../../packages/dsh-tool-manager-panel/lib/client.js').factory((id) => (id === 'react' ? react : {}))
  const spec = loadFactory('../../packages/dsh-tool-manager-dsbot-entry/lib/client.js')
  const mod = spec.factory((id) => (id === 'react' ? react : id === 'react-dom' ? { createPortal: () => null } : id === '@lvy-jsd/dsh-tool-manager-panel' ? panel : {}))
  const { ctx, registrations } = makeCtx()
  mod.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].spec.name, 'shell.overlay')
  assert.equal(registrations[0].spec.locale, 'tool-manager.panel')
})

test('dsbot entry stays silent when the panel plugin is not loaded', () => {
  const spec = loadFactory('../../packages/dsh-tool-manager-dsbot-entry/lib/client.js')
  const mod = spec.factory((id) => {
    if (id === '@lvy-jsd/dsh-tool-manager-panel') throw new Error('module not found')
    return id === 'react' ? react : { createPortal: () => null }
  })
  const { ctx, registrations } = makeCtx()
  mod.apply(ctx)
  assert.equal(registrations.length, 0)
})
