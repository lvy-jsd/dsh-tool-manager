// Attribution scan for dsh-tool-manager.
//
// Groups a tool under the plugin package that defines it. After the catalog is
// built, the plugin reads the source of every enabled plugin package
// (`lib/`, `src/`, `dist/`; never node_modules or tests) once, in the
// background, and indexes the string literals it finds. A tool is attributed
// to a package when exactly one package defines it (`name: '<tool>'`), or,
// failing that, when exactly one package mentions the name at all. Ambiguous
// or unknown names pass, so the core's structural fallback still applies.
//
// MCP tools (`mcp__…`) are skipped: their names are built at runtime, and the
// core already groups them by server.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const name = 'tool-manager-attribution-scan'
export const inject = ['toolCatalog']

export const DEFAULT_PRIORITY = 10
const SOURCE_DIRS = ['lib', 'src', 'dist']
const SKIP_DIRS = new Set(['node_modules', 'test', 'tests', '__tests__', '.git'])
const SOURCE_FILE = /\.(c|m)?js$/
const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES_PER_PACKAGE = 2000
const LITERAL = /(['"`])([a-z][a-z0-9_]{2,63})\1/g
const DEFINITION = /\bname\s*:\s*(['"`])([a-z][a-z0-9_]{2,63})\1/g
// The tool manager's own extensions mention many tool names in rules and docs.
const SELF = /^dsh-tool-manager-/

/** "@scope/dsh-engram" -> "engram" with stripPrefix "dsh-". */
export function groupNameOf(pkg, stripPrefix = 'dsh-') {
  const bare = String(pkg).split('/').pop()
  return stripPrefix && bare.startsWith(stripPrefix) && bare.length > stripPrefix.length ? bare.slice(stripPrefix.length) : bare
}

async function* sourceFiles(dir, budget) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (budget.left <= 0) return
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(path, budget)
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
      budget.left -= 1
      yield path
    }
  }
}

/**
 * Scan packages and return `{ defined, mentioned }`: maps from a literal to the
 * set of package names that define / mention it. Pure apart from reading files.
 */
export async function scanPackages(packages, { exclude = [] } = {}) {
  const excluded = exclude.map((rule) => (rule instanceof RegExp ? rule : new RegExp(`^(?:${rule})$`)))
  const defined = new Map()
  const mentioned = new Map()
  const add = (map, key, pkg) => {
    let set = map.get(key)
    if (!set) map.set(key, (set = new Set()))
    set.add(pkg)
  }
  for (const { name: pkg, dir } of packages) {
    if (SELF.test(pkg) || excluded.some((re) => re.test(pkg))) continue
    const budget = { left: MAX_FILES_PER_PACKAGE }
    for (const sub of SOURCE_DIRS) {
      for await (const file of sourceFiles(join(dir, sub), budget)) {
        let text
        try {
          if ((await stat(file)).size > MAX_FILE_BYTES) continue
          text = await readFile(file, 'utf8')
        } catch {
          continue
        }
        for (const m of text.matchAll(DEFINITION)) add(defined, m[2], pkg)
        for (const m of text.matchAll(LITERAL)) add(mentioned, m[2], pkg)
      }
    }
  }
  return { defined, mentioned }
}

/** The package a tool belongs to, or undefined when the index cannot tell. */
export function attribute(index, toolName) {
  if (!index || toolName.startsWith('mcp__')) return undefined
  const definers = index.defined.get(toolName)
  if (definers?.size === 1) return [...definers][0]
  if (definers?.size > 1) return undefined
  const mentions = index.mentioned.get(toolName)
  return mentions?.size === 1 ? [...mentions][0] : undefined
}

/** Build the classifier around a (possibly not yet ready) index. */
export function attributionClassifier({ priority = DEFAULT_PRIORITY, stripPrefix = 'dsh-', getIndex }) {
  return {
    name: 'attribution:source',
    priority,
    group(tool) {
      const pkg = attribute(getIndex(), tool.name)
      return pkg ? groupNameOf(pkg, stripPrefix) : undefined
    },
  }
}

export function apply(ctx, config = {}) {
  if (config.enabled === false) return
  const logger = ctx.logger?.('tool-manager-attribution-scan') ?? console
  let index = null
  let live = true
  ctx.effect(() => () => { live = false }, 'tool-manager-attribution-scan.lifetime()')

  const classifier = attributionClassifier({
    priority: config.priority ?? DEFAULT_PRIORITY,
    stripPrefix: config.stripPrefix ?? 'dsh-',
    getIndex: () => index,
  })
  ctx.effect(() => ctx.toolCatalog.registerClassifier(classifier), 'tool-manager-attribution-scan.classifier()')

  // Scan once, after the first catalog build, so startup never waits on disk.
  let started = false
  const start = () => {
    if (started) return
    started = true
    const packages = typeof ctx.toolCatalog.packages === 'function' ? ctx.toolCatalog.packages() : []
    scanPackages(packages, { exclude: config.exclude ?? [] })
      .then((result) => {
        if (!live) return
        index = result
        ctx.toolCatalog.refresh()
      })
      .catch((error) => logger.warn?.(`tool-manager-attribution-scan: scan failed: ${error.message}`))
  }
  ctx.effect(() => ctx.on('tool-catalog/after-rebuild', start), 'tool-manager-attribution-scan.start()')
}

export default { name, inject, apply }
