// The `toolCatalog` service: the extension surface other plugins build on.
//
//   registerClassifier({ name, priority, group?(tool), categorize?(group) })
//   annotate(match, { group?, category?, risk?, summary? })
//   defineCategory(name, description)
//   registerVisibilityFilter({ name, filter(agent, names) })
//   refresh(), get(), resolve(target), stateOf(agent)
//
// Every register/annotate/define call returns a disposer. Extension plugins
// should register inside an effect so unloading them undoes the registration:
//   ctx.effect(() => ctx.toolCatalog.registerClassifier({...}))
//
// Hooks are plain Cordis events on the host context:
//   tool-catalog/before-load    (serial; throw to veto)   { agent, targets, names }
//                               also fired by the auto-load of a directly called
//                               hidden tool, with `rescue: true` in the payload
//   tool-catalog/after-load     (emit)                    { agent, targets, added }
//   tool-catalog/before-unload  (serial; throw to veto)   { agent, targets }
//   tool-catalog/after-unload   (emit)                    { agent, targets, removed }
//   tool-catalog/before-rebuild (emit)                    { }
//   tool-catalog/after-rebuild  (emit)                    { catalog }

import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_CATEGORIES } from './catalog.js'

/** Package name of a loader specifier: "@scope/pkg/sub" -> "@scope/pkg", "pkg/sub" -> "pkg". */
export function packageNameOf(specifier) {
  const parts = String(specifier).split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Find a package's package.json starting from a resolvable entry file. */
function findManifest(requireFrom, pkg) {
  try {
    return requireFrom.resolve(`${pkg}/package.json`)
  } catch {
    // exports may hide package.json; walk up from the main entry instead.
  }
  try {
    let dir = dirname(requireFrom.resolve(pkg))
    while (dir !== dirname(dir)) {
      const candidate = join(dir, 'package.json')
      if (existsSync(candidate)) {
        const json = JSON.parse(readFileSync(candidate, 'utf8'))
        if (json.name === pkg) return candidate
      }
      dir = dirname(dir)
    }
  } catch {
    // unresolvable from here
  }
  return undefined
}

/**
 * Read `dsh.toolCatalog` declarations from every plugin package the host loader
 * knows. Declaration format (package.json):
 *
 *   "dsh": { "toolCatalog": {
 *     "match": "^adb_",                 // regex over tool names (optional)
 *     "group": "adb", "category": "device",
 *     "tools": { "adb_install": { "risk": "high", "summary": "..." } }
 *   } }
 *
 * `group`/`category`/`risk`/`summary` at the top level apply to `match`;
 * entries under `tools` apply to exact names and win over the top level.
 */
export function readManifestAnnotations(ctx, logger) {
  const annotations = []
  for (const { name: pkg, manifest: manifestPath } of listPluginPackages(ctx)) {
    try {
      const declared = JSON.parse(readFileSync(manifestPath, 'utf8'))?.dsh?.toolCatalog
      if (!declared) continue
      const top = pick(declared)
      if (declared.match && Object.keys(top).length) annotations.push({ source: pkg, match: new RegExp(declared.match), meta: top })
      for (const [name, meta] of Object.entries(declared.tools ?? {})) {
        annotations.push({ source: pkg, match: name, meta: { ...top, ...pick(meta) } })
      }
    } catch (error) {
      logger?.warn?.(`tool-manager: bad dsh.toolCatalog in ${pkg}: ${error.message}`)
    }
  }
  return annotations
}

/**
 * Every enabled plugin package the host loader knows, as
 * `{ name, dir, manifest }`. Relative (local) entries are skipped.
 */
export function listPluginPackages(ctx) {
  const loader = ctx.get?.('loader')
  if (!loader?.entries) return []
  const bases = [loader.baseUrl, loader.ctx?.baseUrl, ctx.baseUrl, pathToFileURL(join(process.cwd(), 'noop.js')).href].filter(Boolean)
  const seen = new Set()
  const out = []
  for (const entry of loader.entries()) {
    const spec = entry?.options?.name
    if (typeof spec !== 'string' || spec.startsWith('.') || entry.options.disabled === true) continue
    const pkg = packageNameOf(spec)
    if (seen.has(pkg)) continue
    seen.add(pkg)
    for (const base of bases) {
      const from = createRequire(String(base).startsWith('file:') ? fileURLToPath(base) : join(String(base), 'noop.js'))
      const manifest = findManifest(from, pkg)
      if (manifest) {
        out.push({ name: pkg, dir: dirname(manifest), manifest })
        break
      }
    }
  }
  return out
}

function pick(meta = {}) {
  const out = {}
  for (const key of ['group', 'category', 'risk', 'summary']) if (typeof meta[key] === 'string' && meta[key]) out[key] = meta[key]
  return out
}

/** Registries behind the service. `onChange` rebuilds the catalog. */
export function createRegistries(onChange) {
  const classifiers = new Set()
  const annotations = []
  const categories = new Map(Object.entries(DEFAULT_CATEGORIES))
  const filters = new Set()
  const resolvers = new Set()

  const remover = (fn) => {
    let done = false
    return () => {
      if (done) return
      done = true
      fn()
      onChange()
    }
  }

  return {
    classifiers,
    annotations,
    categories,
    filters,
    resolvers,
    registerClassifier(classifier) {
      if (!classifier || (typeof classifier.group !== 'function' && typeof classifier.categorize !== 'function')) {
        throw new TypeError('registerClassifier: provide group(tool) and/or categorize(group)')
      }
      const entry = { name: classifier.name ?? 'anonymous', priority: Number(classifier.priority ?? 0), group: classifier.group, categorize: classifier.categorize }
      classifiers.add(entry)
      onChange()
      return remover(() => classifiers.delete(entry))
    },
    annotate(match, meta) {
      const entry = { source: 'runtime', match: typeof match === 'string' ? match : new RegExp(match), meta: pick(meta) }
      annotations.push(entry)
      onChange()
      return remover(() => annotations.splice(annotations.indexOf(entry), 1))
    },
    defineCategory(name, description = '') {
      const previous = categories.get(name)
      categories.set(name, description)
      onChange()
      return remover(() => (previous === undefined ? categories.delete(name) : categories.set(name, previous)))
    },
    registerVisibilityFilter(filter) {
      if (typeof filter?.filter !== 'function') throw new TypeError('registerVisibilityFilter: provide filter(agent, names)')
      const entry = { name: filter.name ?? 'anonymous', filter: filter.filter }
      filters.add(entry)
      onChange()
      return remover(() => filters.delete(entry))
    },
    /**
     * Own a target prefix in tools_load / tools_ls / tools_unload. `resolve` gets
     * the raw target and returns one or more ordinary targets (paths, group or
     * tool names), or undefined to pass.
     */
    registerTargetResolver(resolver) {
      if (typeof resolver?.resolve !== 'function') throw new TypeError('registerTargetResolver: provide resolve(target)')
      const entry = { name: resolver.name ?? 'anonymous', prefix: String(resolver.prefix ?? ''), resolve: resolver.resolve }
      resolvers.add(entry)
      onChange()
      return remover(() => resolvers.delete(entry))
    },
  }
}
