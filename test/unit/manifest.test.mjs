import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCatalog } from '../../packages/dsh-tool-manager/lib/catalog.js'
import { manifestImport, renderManifest, syncManifest, writeManifest, defaultManifestFile } from '../../packages/dsh-tool-manager/lib/manifest.js'

const schemas = [
  { name: 'adb_install', description: 'Install an APK on a device.' },
  { name: 'adb_shell', description: 'Run a shell command on a device.' },
  { name: 'maps_search', description: 'Search places on a map.' },
  { name: 'merge_pull_request', description: 'Merge a pull request.' },
]

/** A classifier that places the adb group in device and github in code. */
const placer = {
  name: 'test:placer',
  priority: 100,
  group: (tool) => tool.name.split('_')[0],
  categorize: (group) => ({ adb: 'device', github: 'code', maps: 'maps' })[group.name],
}

const catalog = (highRisk = []) => buildCatalog(schemas, {
  classifiers: [placer],
  categories: { device: 'Devices', code: 'Code hosts', maps: 'Maps', uncategorized: 'Not placed' },
  highRisk,
})

test('manifest: the header explains that listed tools are not callable yet', () => {
  const text = renderManifest(catalog())
  assert.match(text, /NOT callable yet/)
  assert.match(text, /`tools_ls` browses/)
  assert.match(text, /`tools_load` makes tools callable/)
  assert.match(text, /do not edit it/)
})

test('manifest: every category, group and tool appears with a load command', () => {
  const text = renderManifest(catalog())
  assert.match(text, /## device \(2 tools, Devices\)/)
  assert.match(text, /### adb — load with `tools_load\(\{ targets: \["\/device\/adb"\] \}\)`/)
  assert.match(text, /- adb_install — Install an APK on a device\./)
  assert.match(text, /- adb_shell — Run a shell command on a device\./)
})

test('manifest: an empty category is skipped rather than listed empty', () => {
  const text = renderManifest(catalog())
  assert.doesNotMatch(text, /## code \(0 tools/)
})

test('manifest: a high-risk tool is marked', () => {
  const text = renderManifest(catalog(['merge_pull_request']))
  assert.match(text, /- merge_pull_request ! — Merge a pull request\./)
})

test('manifest: the always-available tools are named at the end', () => {
  const text = renderManifest(catalog())
  assert.match(text, /## Also always available/)
  assert.match(text, /`tools_ls`, `tools_load`, `tools_unload`/)
})

test('manifest: a tool with no summary still gets a line', () => {
  const cat = buildCatalog([{ name: 'bare_tool' }], { categories: { uncategorized: 'Not placed' } })
  assert.match(renderManifest(cat), /- bare_tool\n/)
})

test('manifest: the import line is an @ path, escaped for spaces', () => {
  assert.equal(manifestImport('/home/x/.claude/catalog.md'), '@/home/x/.claude/catalog.md')
  assert.equal(manifestImport('/home/x/my dir/catalog.md'), '@/home/x/my\\ dir/catalog.md')
})

test('manifest: the default path is under the Claude home', () => {
  assert.match(defaultManifestFile(), /\.claude\/dsh-tool-catalog\.md$/)
})

// --- writing ------------------------------------------------------------------

test('write: creates the file and its directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-manifest-'))
  try {
    const file = join(dir, 'nested', 'catalog.md')
    assert.equal(writeManifest(file, 'hello'), true)
    assert.equal(readFileSync(file, 'utf8'), 'hello')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('write: unchanged text is not rewritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-manifest-'))
  try {
    const file = join(dir, 'catalog.md')
    assert.equal(writeManifest(file, 'one'), true)
    // A second write of the same text must report no change: the file is part
    // of a prompt, so an identical rewrite would still cost a re-read.
    assert.equal(writeManifest(file, 'one'), false)
    assert.equal(writeManifest(file, 'two'), true)
    assert.equal(readFileSync(file, 'utf8'), 'two')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('write: a corrupt existing file is replaced, not appended to', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-manifest-'))
  try {
    const file = join(dir, 'catalog.md')
    writeFileSync(file, 'stale')
    assert.equal(syncManifest(catalog(), file), true)
    assert.match(readFileSync(file, 'utf8'), /# dsh tool catalog/)
    assert.doesNotMatch(readFileSync(file, 'utf8'), /^stale/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('write: an unwritable path warns instead of throwing', () => {
  const warnings = []
  // A file where a directory has to be: mkdir fails, and the catalog must survive.
  const dir = mkdtempSync(join(tmpdir(), 'tm-manifest-'))
  try {
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    assert.equal(writeManifest(join(blocker, 'catalog.md'), 'x', { warn: (m) => warnings.push(m) }), false)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /writing the tool manifest/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
