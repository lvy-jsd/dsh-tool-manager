import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanPackages, attribute, attributionClassifier, groupNameOf } from '../../packages/dsh-tool-manager-attribution-scan/lib/index.js'

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
  'dsh-tool-manager-classifier-rules': { 'lib/index.js': "const t = { name: 'weather_week' }" },
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
