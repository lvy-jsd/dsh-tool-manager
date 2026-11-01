// The old package name re-exports the renamed core unchanged, so a DSH profile
// that loads @lvy-jsd/dsh-tool-manager keeps its loader entry and config.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as legacy from '../../packages/dsh-tool-manager/index.js'
import * as core from '../../packages/dsh-tool-ultra-core/lib/index.js'

test('compat: the old package re-exports the core plugin', () => {
  assert.equal(legacy.default, core.default)
  assert.equal(legacy.apply, core.apply)
  assert.equal(legacy.name, 'tool-manager', 'plugin name unchanged, so state and logs stay where they were')
  assert.deepEqual(legacy.ENTRY_TOOLS, ['tools_ls', 'tools_load', 'tools_unload'])
})

test('compat: the old bundle patch keeps the loader id and only swaps the package name', () => {
  // Windows checkouts may have CRLF line endings.
  const read = (dir) => readFileSync(new URL(`../../packages/${dir}/cordis.patch.yml`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const strip = (text) => text.split('\n').slice(1).join('\n') // first line is a comment naming the package
  assert.match(read('dsh-tool-manager'), /id: tool-manager\n\s+name: '@lvy-jsd\/dsh-tool-manager'/)
  assert.equal(strip(read('dsh-tool-manager')).replace('@lvy-jsd/dsh-tool-manager', '@lvy-jsd/dsh-tool-ultra-core'), strip(read('dsh-tool-ultra-core')))
})

test('compat: the core provides its service under both names', () => {
  const src = readFileSync(new URL('../../packages/dsh-tool-ultra-core/src/index.ts', import.meta.url), 'utf8')
  assert.match(src, /ctx\.provide\('toolCatalog', service\)/)
  assert.match(src, /ctx\.provide\('toolUltra', service\)/)
})
