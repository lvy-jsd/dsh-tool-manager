import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../packages/dsh-tool-manager/lib/index.js'
import { rulesClassifier, DEFAULT_GROUP_RULES, DEFAULT_GROUP_CATEGORIES, DEFAULT_PRIORITY } from '../../packages/dsh-tool-manager-classifier-rules/lib/index.js'

/**
 * The core on a minimal host, with its metadata file inside a temp directory so
 * the test never touches the real ~/.config/deepseek-harness.
 */
function coreHost(toolNames, metadataFile) {
  const tools = new Map(toolNames.map((n) => [n, { name: n, description: `${n} does things.`, parameters: {} }]))
  const listeners = new Map()
  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(handler)
    return () => listeners.set(event, listeners.get(event).filter((h) => h !== handler))
  }
  const agent = { id: 's1', options: { provider: 'fake' }, ctx: { tools: { restrict: () => () => {} } } }
  const services = {}
  const ctx = {
    logger: () => ({ warn() {}, info() {}, debug() {} }),
    tools: {
      schemas: () => [...tools.values()],
      register: (def) => { tools.set(def.name, { name: def.name, description: def.description ?? '', parameters: {} }); return () => tools.delete(def.name) },
    },
    on,
    emit: (event, ...args) => { for (const h of listeners.get(event) ?? []) h(...args) },
    serial: async (event, ...args) => { for (const h of listeners.get(event) ?? []) await h(...args) },
    effect: (fn) => fn(),
    provide: (name, service) => { services[name] = service },
    inject: (deps, fn) => fn({ agents: { list: () => [agent], get: () => undefined }, effect: (fn) => fn(), on }),
    get: () => undefined,
  }
  apply(ctx, { metadataFile })
  return { catalog: services.toolCatalog, listeners }
}

const tempMeta = () => join(mkdtempSync(join(tmpdir(), 'tm-toolmeta-')), 'metadata.json')

test('toolMeta: the catalog tool metadata is reported with its path', () => {
  // Two tools with the same prefix, so the structural fallback forms an "adb" group.
  const { catalog } = coreHost(['adb_install', 'adb_shell'], tempMeta())
  const meta = catalog.toolMeta('adb_install')
  assert.equal(meta.name, 'adb_install')
  assert.equal(meta.found, true)
  assert.equal(meta.missing, false)
  assert.equal(meta.path, '/uncategorized/adb/adb_install')
  assert.deepEqual(meta.edited, {})
  assert.equal(catalog.metadataFile(), catalog.metadataFile())
})

test('toolMeta: an unknown tool is reported missing, not thrown', () => {
  const { catalog } = coreHost(['adb_install'], tempMeta())
  const meta = catalog.toolMeta('nope_not_here')
  assert.equal(meta.found, false)
  assert.equal(meta.missing, true)
  assert.equal(meta.path, '')
})

test('updateToolMeta: an edit lands in the catalog, and clearing falls back', () => {
  const { catalog } = coreHost(['adb_install'], tempMeta())
  const edited = catalog.updateToolMeta('adb_install', { category: 'device', group: 'flash', summary: 'Flash it.', risk: 'high' })
  assert.equal(edited.category, 'device')
  assert.equal(edited.group, 'flash')
  assert.equal(edited.highRisk, true)
  assert.deepEqual(edited.edited, { category: 'device', group: 'flash', summary: 'Flash it.', risk: 'high' })
  assert.equal(catalog.get().tools.get('adb_install').category, 'device')
  assert.equal(catalog.get().tools.get('adb_install').summary, 'Flash it.')

  const cleared = catalog.clearToolMeta('adb_install')
  assert.deepEqual(cleared.edited, {})
  assert.equal(cleared.category, 'uncategorized')
})

test('updateToolMeta: an edit wins over a package declaration', () => {
  const { catalog } = coreHost(['adb_install', 'adb_shell'], tempMeta())
  // A string match is exact; a pattern needs a RegExp.
  catalog.annotate(/^adb_/, { category: 'code', summary: 'Declared by the package.' })
  assert.equal(catalog.get().tools.get('adb_install').category, 'code')
  catalog.updateToolMeta('adb_install', { category: 'device' })
  assert.equal(catalog.get().tools.get('adb_install').category, 'device')
  // The declaration is still visible as the layer underneath the edit.
  assert.deepEqual(catalog.toolMeta('adb_install').declared, { category: 'code', summary: 'Declared by the package.' })
})

test('updateToolMeta: an edit wins over a classifier', () => {
  const { catalog } = coreHost(['adb_install', 'adb_shell'], tempMeta())
  catalog.registerClassifier(rulesClassifier({ name: 'rules:defaults', priority: DEFAULT_PRIORITY, groupRules: DEFAULT_GROUP_RULES, groupCategories: DEFAULT_GROUP_CATEGORIES }))
  assert.equal(catalog.get().tools.get('adb_install').category, 'device')
  catalog.updateToolMeta('adb_install', { category: 'media' })
  assert.equal(catalog.get().tools.get('adb_install').category, 'media')
})

test('updateToolMeta: an emptied field falls back to the declaration', () => {
  const { catalog } = coreHost(['adb_install'], tempMeta())
  catalog.updateToolMeta('adb_install', { group: 'flash', summary: 'Flash it.' })
  // The whole form is submitted again, with the summary field cleared.
  catalog.updateToolMeta('adb_install', { group: 'flash' })
  assert.deepEqual(catalog.toolMeta('adb_install').edited, { group: 'flash' })
  assert.equal(catalog.get().tools.get('adb_install').summary, 'adb_install does things.')
})

test('updateToolMeta: edits persist to the file and survive a reload', () => {
  const file = tempMeta()
  const { catalog } = coreHost(['adb_install'], file)
  catalog.updateToolMeta('adb_install', { group: 'flash' })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { adb_install: { group: 'flash' } })
  const again = coreHost(['adb_install'], file)
  assert.deepEqual(again.catalog.toolMeta('adb_install').edited, { group: 'flash' })
  assert.equal(again.catalog.get().tools.get('adb_install').group, 'flash')
})

test('updateToolMeta: an edit emits metadata-changed for open panels', () => {
  const { catalog, listeners } = coreHost(['adb_install'], tempMeta())
  const seen = []
  listeners.set('tool-catalog/metadata-changed', [(payload) => seen.push(payload)])
  catalog.updateToolMeta('adb_install', { group: 'flash' })
  catalog.clearToolMeta('adb_install')
  assert.deepEqual(seen, [{ name: 'adb_install' }, { name: 'adb_install' }])
})
