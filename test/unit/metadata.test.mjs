import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMetadataStore, defaultMetadataFile, pickMeta, pickMetadata, readMetadataFile, writeMetadataFile } from '../../packages/dsh-tool-manager/lib/metadata.js'

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'tm-metadata-')), 'metadata.json')

test('metadata: pickMeta keeps the four editable fields and drops the rest', () => {
  assert.deepEqual(pickMeta({ group: 'adb', category: ' device ', risk: 'high', summary: 'Install.' }), {
    group: 'adb', category: 'device', risk: 'high', summary: 'Install.',
  })
  // Parameters are deliberately not part of this file: the host owns them.
  assert.deepEqual(pickMeta({ parameters: { type: 'object' }, group: 'adb' }), { group: 'adb' })
  assert.deepEqual(pickMeta({ group: 3, risk: '' }), {})
  assert.deepEqual(pickMeta(null), {})
})

test('metadata: pickMetadata drops empty and malformed entries', () => {
  assert.deepEqual(pickMetadata({ a: { group: 'x' }, b: {}, c: 'nope' }), { a: { group: 'x' } })
  assert.deepEqual(pickMetadata(null), {})
})

test('metadata: a missing file reads as no override, not a crash', () => {
  assert.deepEqual(readMetadataFile(tempFile()), {})
})

test('metadata: a corrupt file is ignored with a warning', () => {
  const file = tempFile()
  writeFileSync(file, '[not json')
  const warnings = []
  assert.deepEqual(readMetadataFile(file, { warn: (m) => warnings.push(m) }), {})
  assert.equal(warnings.length, 1)
})

test('metadata: set replaces the entry, so an emptied field falls back', () => {
  const file = tempFile()
  const store = createMetadataStore({ file })
  store.set('adb_install', { group: 'adb', risk: 'high' })
  // The second save is the whole form: `risk` is gone rather than kept.
  store.set('adb_install', { group: 'flash' })
  assert.deepEqual(store.get('adb_install'), { group: 'flash' })
})

test('metadata: saving only blanks removes the override', () => {
  const file = tempFile()
  const store = createMetadataStore({ file })
  store.set('adb_install', { group: 'adb' })
  assert.equal(store.set('adb_install', {}), undefined)
  assert.equal(store.get('adb_install'), undefined)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {})
})

test('metadata: clear drops one tool and leaves the others', () => {
  const store = createMetadataStore({ file: tempFile() })
  store.set('a', { group: 'x' })
  store.set('b', { group: 'y' })
  store.clear('a')
  assert.deepEqual(Object.keys(store.all()), ['b'])
})

test('metadata: annotations match one tool by exact name', () => {
  const store = createMetadataStore({ file: tempFile() })
  store.set('adb_install', { group: 'flash' })
  assert.deepEqual(store.annotations(), [{ source: 'tool-manager:metadata', match: 'adb_install', meta: { group: 'flash' } }])
})

test('metadata: reload picks up an external edit', () => {
  const file = tempFile()
  const store = createMetadataStore({ file })
  store.set('a', { group: 'x' })
  writeFileSync(file, JSON.stringify({ a: { group: 'y' } }))
  assert.deepEqual(store.reload(), { a: { group: 'y' } })
  assert.deepEqual(store.get('a'), { group: 'y' })
})

test('metadata: writing creates the directory and leaves no temp file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tm-metadata-')), 'nested', 'metadata.json')
  writeMetadataFile(file, { a: { group: 'x' } })
  assert.equal(existsSync(file), true)
  assert.deepEqual(readdirSync(join(file, '..')), ['metadata.json'])
})

test('metadata: defaultMetadataFile follows DSH_HOME', () => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dsh-home'
  try {
    assert.equal(defaultMetadataFile(), '/tmp/dsh-home/tool-manager/metadata.json')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
