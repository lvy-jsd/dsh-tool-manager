// Build the Rust retrieval sidecar and copy it to sidecar/bin/, where the
// published package carries it. Run before `npm publish` on Linux.
//
// The binary is never committed: a build from a NixOS machine points at a
// /nix/store loader and does not start anywhere else. For a package other
// Linux machines can run, build a static binary:
//
//   rustup target add x86_64-unknown-linux-musl
//   SIDECAR_TARGET=x86_64-unknown-linux-musl npm run build:sidecar
//
// The sidecar is Linux-only (Unix sockets, prctl); elsewhere the plugin uses
// its JS BM25 index, so this script refuses to run on other platforms.
import { spawnSync } from 'node:child_process'
import { copyFileSync, chmodSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux') {
  console.error(`build-sidecar: the sidecar is Linux-only; nothing to build on ${process.platform}`)
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'packages', 'Tool Ultra', 'sidecar')
const target = process.env.SIDECAR_TARGET
const args = ['build', '--release', '--manifest-path', join(crate, 'Cargo.toml')]
if (target) args.push('--target', target)

const run = spawnSync('cargo', args, { stdio: 'inherit' })
if (run.error) {
  console.error(`build-sidecar: could not run cargo: ${run.error.message}`)
  process.exit(1)
}
if (run.status !== 0) process.exit(run.status ?? 1)

const built = join(crate, 'target', ...(target ? [target] : []), 'release', 'tool-router-sidecar')
const out = join(crate, 'bin', 'tool-router-sidecar')
mkdirSync(dirname(out), { recursive: true })
copyFileSync(built, out)
chmodSync(out, 0o755)
console.log(`build-sidecar: ${out}`)
