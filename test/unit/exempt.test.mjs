import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createExemptStore, defaultExemptFile, pickExempt, readExemptFile, writeExemptFile } from '../../packages/dsh-tool-manager/lib/exempt.js'

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'tm-exempt-')), 'exempt.json')

test('exempt: pickExempt keeps the two lists and drops the rest', () => {
  assert.deepEqual(pickExempt({ providers: ['claude-code'], sessions: ['s_1'], note: 'x' }), {
    providers: ['claude-code'], sessions: ['s_1'],
  })
  // A number or a blank string in the file is a typo, not a name.
  assert.deepEqual(pickExempt({ providers: ['ok', '', 3, null], sessions: 'nope' }), { providers: ['ok'], sessions: [] })
  assert.deepEqual(pickExempt(null), { providers: [], sessions: [] })
  assert.deepEqual(pickExempt(['claude-code']), { providers: [], sessions: [] })
})

test('exempt: a missing file is "no opinion", not an empty list', () => {
  // The store must be able to tell "no file" (fall back to config) from
  // "file says nothing" (exempt nobody), so a missing file returns undefined.
  assert.equal(readExemptFile(tempFile()), undefined)
})

test('exempt: a corrupt file exempts nobody and warns, rather than restoring config', () => {
  const file = tempFile()
  writeFileSync(file, '{oops')
  const warnings = []
  assert.deepEqual(readExemptFile(file, { warn: (m) => warnings.push(m) }), { providers: [], sessions: [] })
  assert.equal(warnings.length, 1)
})

test('exempt: without a file the plugin config decides', () => {
  const store = createExemptStore({ file: tempFile(), configProviders: ['claude-code'] })
  assert.equal(store.present(), false)
  assert.deepEqual(store.effective(), { providers: ['claude-code'], sessions: [] })
})

test('exempt: an existing file replaces the config list instead of merging with it', () => {
  const file = tempFile()
  writeFileSync(file, JSON.stringify({ providers: ['codex'] }))
  const store = createExemptStore({ file, configProviders: ['claude-code'] })
  assert.equal(store.present(), true)
  // `claude-code` came from the config and must be gone: a partial merge would
  // leave entries the operator cannot see in the file.
  assert.deepEqual(store.effective(), { providers: ['codex'], sessions: [] })
})

test('exempt: reasonFor names which layer exempted the session', () => {
  const fromConfig = createExemptStore({ file: tempFile(), configProviders: ['claude-code'] })
  assert.deepEqual(fromConfig.reasonFor('claude-code', 's_1'), { exempt: true, source: 'config:provider' })
  assert.deepEqual(fromConfig.reasonFor('codex', 's_1'), { exempt: false, source: '' })

  const file = tempFile()
  writeFileSync(file, JSON.stringify({ providers: ['codex'], sessions: ['s_2'] }))
  const fromFile = createExemptStore({ file, configProviders: ['claude-code'] })
  assert.deepEqual(fromFile.reasonFor('codex', 's_1'), { exempt: true, source: 'file:provider' })
  assert.deepEqual(fromFile.reasonFor('other', 's_2'), { exempt: true, source: 'file:session' })
  assert.deepEqual(fromFile.reasonFor(undefined, undefined), { exempt: false, source: '' })
})

test('exempt: the first session edit writes a file that keeps what was already exempt', () => {
  const file = tempFile()
  const store = createExemptStore({ file, configProviders: ['claude-code'] })
  store.setSession('s_1', true)
  // Starting from the effective list, not from empty: the config exemption the
  // user could see stays in force once the file takes over.
  assert.deepEqual(store.effective(), { providers: ['claude-code'], sessions: ['s_1'] })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { providers: ['claude-code'], sessions: ['s_1'] })
})

test('exempt: un-exempting one session leaves the others', () => {
  const file = tempFile()
  writeFileSync(file, JSON.stringify({ providers: [], sessions: ['s_1', 's_2'] }))
  const store = createExemptStore({ file })
  store.setSession('s_1', false)
  assert.deepEqual(store.effective().sessions, ['s_2'])
  assert.deepEqual(store.reasonFor(undefined, 's_1'), { exempt: false, source: '' })
})

test('exempt: reload picks up an external edit and can drop back to the config', () => {
  const file = tempFile()
  writeFileSync(file, JSON.stringify({ providers: ['codex'] }))
  const store = createExemptStore({ file, configProviders: ['claude-code'] })
  writeFileSync(file, JSON.stringify({ providers: ['zed'] }))
  assert.deepEqual(store.reload(), { providers: ['zed'], sessions: [] })
  // Deleting the file hands control back to the plugin config.
  unlinkSync(file)
  assert.deepEqual(store.reload(), { providers: ['claude-code'], sessions: [] })
})

test('exempt: writing creates the directory and leaves no temp file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tm-exempt-')), 'nested', 'exempt.json')
  writeExemptFile(file, { providers: ['claude-code'], sessions: [] })
  assert.equal(existsSync(file), true)
  assert.deepEqual(readdirSync(join(file, '..')), ['exempt.json'])
})

test('exempt: defaultExemptFile follows DSH_HOME', () => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dsh-home'
  try {
    assert.equal(defaultExemptFile(), '/tmp/dsh-home/tool-manager/exempt.json')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
