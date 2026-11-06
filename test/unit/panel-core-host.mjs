import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../packages/dsh-tool-ultra-core/lib/index.js'

// An isolated real core with serial hooks and a live, restrictable agent.
export function coreHost(t) {
  const dir = mkdtempSync(join(tmpdir(), 'b5-core-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const definitions = new Map(['alpha_tool', 'beta_tool', 'read'].map((name) => [name, { name, description: name, parameters: {} }]))
  const listeners = new Map()
  const events = []
  const disposers = []
  const on = (event, fn) => {
    const handlers = listeners.get(event) ?? []
    listeners.set(event, [...handlers, fn])
    return () => listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== fn))
  }
  const effect = (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) }
  t.after(() => disposers.reverse().forEach((dispose) => dispose()))
  const restrictions = new Set()
  const agent = { id: 'session-b5', options: { provider: 'fake' }, ctx: { tools: { restrict: ({ allow }) => { const entry = new Set(allow); restrictions.add(entry); return () => restrictions.delete(entry) } } } }
  const services = {}
  const ctx = {
    logger: () => ({ warn() {}, info() {}, debug() {} }),
    tools: {
      schemas: (scope) => [...definitions.values()].filter((def) => !scope || [...restrictions].every((allow) => allow.has(def.name))),
      register: (def) => { definitions.set(def.name, def); return () => definitions.delete(def.name) },
    },
    effect, on,
    emit: (event, ...args) => { events.push({ event, args }); for (const fn of listeners.get(event) ?? []) fn(...args) },
    serial: async (event, ...args) => { for (const fn of listeners.get(event) ?? []) await fn(...args) },
    provide: (name, service) => { services[name] = service },
    inject: (_deps, fn) => fn({ agents: { list: () => [agent], get: () => undefined }, effect, on }),
    get: () => undefined,
  }
  const settingsFile = join(dir, 'settings.json')
  apply(ctx, { settingsFile, metadataFile: join(dir, 'metadata.json'), exemptFile: join(dir, 'exempt.json'), manifestFile: '', sidecar: { bin: '/nonexistent' } })
  // Registration finishes after the initial visibility mount, as in host startup.
  services.toolCatalog.refresh()
  return { catalog: services.toolCatalog, agent, ctx, on, events, settingsFile,
    execute: (name, args = {}) => definitions.get(name).execute(args, { agent }),
    preExecute: (name) => listeners.get('tools/pre-execute')[0]({ agent, name, arguments: {} }, () => ({ kind: 'allow' })),
  }
}
