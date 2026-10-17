import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsStore, defaultSettingsFile, pickSettings, readSettingsFile, writeSettingsFile } from '../../packages/dsh-tool-manager/lib/settings.js'

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'tm-settings-')), 'config.json')

test('settings: pickSettings keeps known string arrays and drops everything else', () => {
  assert.deepEqual(pickSettings({ pinned: ['a', 'b'], unpin: [], highRisk: ['c'] }), { pinned: ['a', 'b'], unpin: [], highRisk: ['c'] })
  // Unknown keys, wrong types and non-string entries are dropped, not coerced.
  assert.deepEqual(pickSettings({ nope: ['a'], pinned: 'a', highRisk: ['ok', 3, null, ''] }), { highRisk: ['ok'] })
  assert.deepEqual(pickSettings(null), {})
  assert.deepEqual(pickSettings(['pinned']), {})
})

test('settings: a missing file reads as no override, not a crash', () => {
  assert.deepEqual(readSettingsFile(tempFile()), {})
})

test('settings: a corrupt file is ignored with a warning', () => {
  const file = tempFile()
  writeFileSync(file, '{not json')
  const warnings = []
  assert.deepEqual(readSettingsFile(file, { warn: (m) => warnings.push(m) }), {})
  assert.equal(warnings.length, 1)
})

test('settings: the store falls back to the plugin config per key', () => {
  const store = createSettingsStore({ file: tempFile(), base: { pinned: ['from-config'], highRisk: ['risky'] } })
  assert.deepEqual(store.effective(), { pinned: ['from-config'], unpin: [], highRisk: ['risky'] })
  assert.equal(store.stored().pinned, undefined)
})

test('settings: update merges per key and persists to disk', () => {
  const file = tempFile()
  const store = createSettingsStore({ file, base: { pinned: ['from-config'] } })
  store.update({ pinned: ['mine'] })
  store.update({ highRisk: ['merge_pull_request'] })
  // The second update must not drop the first key.
  assert.deepEqual(store.effective(), { pinned: ['mine'], unpin: [], highRisk: ['merge_pull_request'] })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pinned: ['mine'], highRisk: ['merge_pull_request'] })
  assert.equal(store.file, file)
})

test('settings: an empty array in the file clears the config value', () => {
  const file = tempFile()
  writeSettingsFile(file, { pinned: [] })
  const store = createSettingsStore({ file, base: { pinned: ['from-config'] } })
  assert.deepEqual(store.effective().pinned, [])
  assert.equal(store.stored().pinned !== undefined, true)
})

test('settings: reload picks up an external edit', () => {
  const file = tempFile()
  const store = createSettingsStore({ file })
  assert.deepEqual(store.effective().pinned, [])
  writeSettingsFile(file, { pinned: ['typed-by-hand'] })
  assert.deepEqual(store.effective().pinned, [])
  assert.deepEqual(store.reload().pinned, ['typed-by-hand'])
})

test('settings: writing creates the directory and leaves no temp file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-settings-'))
  const file = join(dir, 'nested', 'tool-manager', 'config.json')
  writeSettingsFile(file, { unpin: ['x'] })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { unpin: ['x'] })
  assert.equal(existsSync(`${file}.tmp`), false)
})

test('settings: defaultSettingsFile follows DSH_HOME', () => {
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dsh-home-test'
  try {
    assert.equal(defaultSettingsFile(), '/tmp/dsh-home-test/tool-manager/config.json')
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
  }
})
