import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffold, parseArgs, TYPES, USAGE } from '../../packages/create-tool-manager-plugin/lib/cli.js'

const cli = new URL('../../packages/create-tool-manager-plugin/lib/index.js', import.meta.url).pathname

function scratch() {
  return mkdtempSync(join(tmpdir(), 'dsh-tm-scaffold-'))
}

// --- argument parsing ---------------------------------------------------------
test('args: a name and a type, with a default type', () => {
  assert.deepEqual(parseArgs(['my-ext']), { name: 'my-ext', type: 'classifier' })
  assert.deepEqual(parseArgs(['my-ext', '--type', 'filter']), { name: 'my-ext', type: 'filter' })
  assert.deepEqual(parseArgs(['my-ext', '--type', 'hook', '--dir', '/tmp/x']), { name: 'my-ext', type: 'hook', dir: '/tmp/x' })
  assert.equal(parseArgs(['--help']).help, true)
})

test('args: an unknown flag is an error, not a silently ignored argument', () => {
  assert.throws(() => parseArgs(['my-ext', '--nope']), /unexpected argument/)
})

// --- generated packages -------------------------------------------------------
test('scaffold: every type generates a complete package', () => {
  const dir = scratch()
  try {
    for (const type of TYPES) {
      const target = join(dir, `my-${type}`)
      const result = scaffold({ name: `my-${type}`, type, dir: target })
      assert.equal(result.type, type)
      assert.ok(existsSync(join(target, 'package.json')))
      assert.ok(existsSync(join(target, 'cordis.patch.yml')), `${type} has a patch`)
      assert.ok(existsSync(join(target, 'README.md')))
      assert.ok(existsSync(join(target, 'LICENSE')))
      // A declaration needs no code; every other type has a lib entry.
      assert.equal(existsSync(join(target, 'lib/index.js')), type !== 'declaration')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: the package.json is valid and points at the real entry', () => {
  const dir = scratch()
  try {
    const target = join(dir, 'pkg')
    scaffold({ name: 'pkg', type: 'classifier', dir: target })
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    assert.equal(manifest.name, 'pkg')
    assert.equal(manifest.type, 'module')
    assert.equal(manifest.main, 'lib/index.js')
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.ok(manifest.peerDependencies['@lvy-jsd/dsh-tool-manager'], 'declares the scoped core as a peer')
    assert.equal(manifest.peerDependencies['dsh-tool-manager'], undefined, 'never the unscoped name (another project)')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: a declaration puts its metadata in package.json and ships no lib', () => {
  const dir = scratch()
  try {
    const target = join(dir, 'decl')
    scaffold({ name: 'decl', type: 'declaration', dir: target })
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    assert.ok(manifest.dsh.toolCatalog, 'has a dsh.toolCatalog block')
    assert.equal(typeof manifest.dsh.toolCatalog.match, 'string')
    assert.equal(existsSync(join(target, 'lib')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: the generated patch references the package it belongs to', () => {
  const dir = scratch()
  try {
    const target = join(dir, 'patched')
    scaffold({ name: 'patched', type: 'filter', dir: target })
    const patch = readFileSync(join(target, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /name: patched/)
    assert.match(patch, /insert:/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: an unknown type is refused', () => {
  const dir = scratch()
  try {
    assert.throws(() => scaffold({ name: 'x', type: 'nonsense', dir: join(dir, 'x') }), /unknown type/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: an unusable name is refused', () => {
  const dir = scratch()
  try {
    assert.throws(() => scaffold({ name: '!!!', type: 'classifier', dir: join(dir, 'x') }), /not a usable package name/)
    assert.throws(() => scaffold({ type: 'classifier', dir: join(dir, 'x') }), /name is required/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: an existing package is never overwritten', () => {
  const dir = scratch()
  try {
    const target = join(dir, 'taken')
    scaffold({ name: 'taken', type: 'classifier', dir: target })
    writeFileSync(join(target, 'lib/index.js'), '// mine\n')
    assert.throws(() => scaffold({ name: 'taken', type: 'filter', dir: target }), /refusing to overwrite/)
    assert.equal(readFileSync(join(target, 'lib/index.js'), 'utf8'), '// mine\n', 'the user file survives')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scaffold: a name is normalized to kebab-case', () => {
  const dir = scratch()
  try {
    const result = scaffold({ name: 'My Cool Extension', type: 'classifier', dir: join(dir, 'x') })
    assert.equal(result.package, 'my-cool-extension')
    assert.match(readFileSync(join(result.dir, 'package.json'), 'utf8'), /"name": "my-cool-extension"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cli: the usage text lists every type', () => {
  for (const type of TYPES) assert.ok(USAGE.includes(type), `usage mentions ${type}`)
})

// --- the generated test actually passes ---------------------------------------
// This is the point of the scaffolder: what it writes must work, not just exist.
test('cli: a generated package passes its own test', { timeout: 120_000 }, () => {
  const dir = scratch()
  try {
    for (const type of TYPES) {
      const target = join(dir, type)
      execFileSync(process.execPath, [cli, `gen-${type}`, '--type', type, '--dir', target], { stdio: 'pipe' })
      // NODE_TEST_CONTEXT is inherited from this outer runner and would make
      // the child run in test-child mode, printing no summary at all.
      const env = { ...process.env }
      delete env.NODE_TEST_CONTEXT
      const out = execFileSync(process.execPath, ['--test', `test/gen-${type}.test.mjs`], {
        cwd: target, encoding: 'utf8', timeout: 60_000, env,
      })
      // The reporter switches format when piped, so match either spelling.
      assert.match(out, /(?:#|ℹ) pass \d+/, `${type} test output:\n${out}`)
      assert.doesNotMatch(out, /(?:#|ℹ) fail [1-9]/, `${type} had failures:\n${out}`)
      assert.doesNotMatch(out, /not ok/, `${type} had failures:\n${out}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cli: a bad type exits non-zero with usage', () => {
  const dir = scratch()
  try {
    let status = 0
    let output = ''
    try {
      output = execFileSync(process.execPath, [cli, 'x', '--type', 'nope', '--dir', join(dir, 'x')], { encoding: 'utf8', stdio: 'pipe' })
    } catch (error) {
      status = error.status
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    assert.equal(status, 1)
    assert.match(output, /unknown type/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
