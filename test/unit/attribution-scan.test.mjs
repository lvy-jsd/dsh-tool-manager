import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, scanPackages, attribute, attributionClassifier, groupNameOf } from '../../packages/dsh-tool-manager-attribution-scan/lib/index.js'

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'tm-attr-'))
  const packages = []
  for (const [pkg, sources] of Object.entries(files)) {
    const dir = join(root, pkg.replace('/', '__'))
    for (const [rel, text] of Object.entries(sources)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    packages.push({ name: pkg, dir })
  }
  return packages
}

const packages = fixture({
  'dsh-weather': { 'lib/index.js': "defineTool({ name: 'weather_now' })\nconst other = 'weather_week'" },
  '@acme/dsh-notes': { 'src/tools/notes.js': "export const tool = { name: \"note_add\" }" },
  'ds-bot': { 'lib/team.js': "const TEAM_TOOLS = ['note_add', 'weather_now', 'shared_name']" },
  'dsh-other': { 'lib/x.js': "const a = 'shared_name'", 'test/x.test.js': "const t = { name: 'weather_week' }" },
  'dsh-big': { 'node_modules/dep/lib/y.js': "const t = { name: 'hidden_dep_tool' }" },
  '@lvy-jsd/dsh-tool-manager-classifier-rules': { 'lib/index.js': "const t = { name: 'weather_week' }" },
})

test('a single definer wins over packages that only mention the name', async () => {
  const index = await scanPackages(packages)
  assert.equal(attribute(index, 'weather_now'), 'dsh-weather')
  assert.equal(attribute(index, 'note_add'), '@acme/dsh-notes')
})

test('a name mentioned by one package only is attributed to it', async () => {
  const index = await scanPackages(packages)
  assert.equal(attribute(index, 'weather_week'), 'dsh-weather')
})

test('ambiguous, unknown and MCP names pass', async () => {
  const index = await scanPackages(packages)
  assert.equal(attribute(index, 'shared_name'), undefined)
  assert.equal(attribute(index, 'no_such_tool'), undefined)
  assert.equal(attribute(index, 'mcp__weather__now'), undefined)
  assert.equal(attribute(null, 'weather_now'), undefined)
})

test('tests, node_modules, the tool manager itself and excluded packages are not scanned', async () => {
  const index = await scanPackages(packages, { exclude: ['ds-bot'] })
  assert.equal(attribute(index, 'hidden_dep_tool'), undefined)
  // Only dsh-other mentions shared_name once ds-bot is excluded.
  assert.equal(attribute(index, 'shared_name'), 'dsh-other')
  assert.equal(index.defined.get('weather_week'), undefined)
})

test('group names drop the scope and the configured prefix', () => {
  assert.equal(groupNameOf('@acme/dsh-notes'), 'notes')
  assert.equal(groupNameOf('ds-bot'), 'ds-bot')
  assert.equal(groupNameOf('dsh-'), 'dsh-')
  assert.equal(groupNameOf('dsh-engram', ''), 'dsh-engram')
})

test('the classifier passes until the index is ready', async () => {
  let index = null
  const classifier = attributionClassifier({ getIndex: () => index })
  assert.equal(classifier.priority, 10)
  assert.equal(classifier.group({ name: 'weather_now' }), undefined)
  index = await scanPackages(packages)
  assert.equal(classifier.group({ name: 'weather_now' }), 'weather')
  assert.equal(classifier.group({ name: 'note_add' }), 'notes')
})

// DSH passes ctx.logger as a factory, but a host (or a test kit) may pass a
// logger object; the other extensions accept both, so this one must too.
for (const form of ['function', 'object']) {
  test(`apply accepts ctx.logger as a ${form} and warns through it`, async () => {
    const warnings = []
    const logger = { info() {}, warn: (message) => warnings.push(message) }
    const listeners = new Map()
    const ctx = {
      logger: form === 'function' ? () => logger : logger,
      effect: (fn) => fn(),
      on: (event, handler) => { listeners.set(event, handler); return () => {} },
      toolCatalog: {
        registerClassifier: () => () => {},
        // A package without a usable dir makes the background scan fail.
        packages: () => [{ name: 'dsh-broken', dir: null }],
        refresh() {},
      },
    }
    // The scan feature does not exercise the router, so keep the sidecar out:
    // a spawned sidecar child would keep the event loop alive past the test.
    apply(ctx, { sidecar: { bin: '/nonexistent' } })
    listeners.get('tool-catalog/after-rebuild')()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /scan failed/)
  })
}
