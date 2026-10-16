// Link the host's @deepseek-ai packages into each workspace package that
// declares them as peers, so tests and type checks use the DSH you run.
//
// npm never installs them here (.npmrc legacy-peer-deps): a copy from the
// registry would shadow the live host at runtime, and npm install removes
// hand-made links, so this runs after every install.
//
// Host location: $DSH_APP, else ~/.local/share/deepseek-harness/app.
// Without a local DSH this does nothing.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = process.env.DSH_APP ?? join(homedir(), '.local/share/deepseek-harness/app')
const hostModules = join(app, 'node_modules')

if (!existsSync(hostModules)) {
  console.log(`link-host: no DSH at ${app}; skipped`)
  process.exit(0)
}

// Workspace packages, plus the e2e test kit (a plugin the tests load).
const pkgDirs = [...readdirSync(join(root, 'packages')).map((d) => join(root, 'packages', d)), join(root, 'test', 'testkit')]

for (const pkgDir of pkgDirs) {
  const dir = pkgDir.slice(root.length + 1)
  const manifest = join(pkgDir, 'package.json')
  if (!existsSync(manifest)) continue
  const peers = Object.keys(JSON.parse(readFileSync(manifest, 'utf8')).peerDependencies ?? {})
  for (const peer of peers.filter((p) => p.startsWith('@deepseek-ai/'))) {
    const target = join(hostModules, peer)
    if (!existsSync(target)) continue
    const link = join(pkgDir, 'node_modules', peer)
    mkdirSync(dirname(link), { recursive: true })
    if (existsSync(link) || isLink(link)) rmSync(link, { recursive: true, force: true })
    symlinkSync(target, link)
    console.log(`link-host: ${dir} -> ${peer}`)
  }
}

function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
