// Builds the three-level tool directory: category -> group -> tool.
//
// The core knows no rules. Placement comes from, in order:
//   1. override classifiers (priority >= OVERRIDE_PRIORITY), e.g. user config
//   2. annotations declared by plugins (package.json `dsh.toolCatalog`, annotate())
//   3. ordinary classifiers, highest priority first
//   4. a structural fallback: group from the tool name, category `uncategorized`
//
// Grouping never decides visibility; a misplaced tool is only listed in the
// wrong place, never lost.

export const UNCATEGORIZED = 'uncategorized'
export const MISC_GROUP = 'misc'
export const OVERRIDE_PRIORITY = 1000

// The fixed category vocabulary. Plugins may add more with defineCategory().
export const DEFAULT_CATEGORIES = {
  device: 'Phones, Android, ADB and desktop control',
  code: 'Source hosting, repositories and package tooling',
  media: 'Video, image and audio services',
  maps: 'Maps, geocoding and routing',
  browser: 'Headless browser automation',
  memory: 'Long-term memory and knowledge stores',
  collaboration: 'Bots, group chats, teammates and other sessions',
  automation: 'Schedules and automated runs',
  connectors: 'MCP connector administration',
  search: 'Web and social search',
  system: 'Host, OS and secrets',
  [UNCATEGORIZED]: 'Tools no classifier has placed yet',
}

// Leading words that describe an action rather than an owner; a shared verb
// prefix ("list_", "get_") is not a meaningful group.
const VERB_PREFIXES = new Set([
  'add', 'ask', 'attach', 'create', 'delete', 'detach', 'edit', 'exit', 'get',
  'interrupt', 'list', 'message', 'open', 'post', 'read', 'remove', 'request',
  'run', 'save', 'send', 'set', 'spawn', 'stop', 'update', 'wait', 'write',
])

/**
 * Structural group for a tool name, used when nothing else places it:
 * `mcp__server__tool` -> server, `mcp__server__sub__tool` -> server-sub,
 * `prefix_rest` -> prefix when at least two tools share a non-verb prefix, else misc.
 */
export function structuralGroup(name, prefixCounts) {
  if (name.startsWith('mcp__')) {
    const parts = name.slice(5).split('__')
    if (parts.length >= 3) return `${parts[0]}-${parts[1]}`
    return parts[0]
  }
  const prefix = name.split('_')[0]
  if (prefix !== name && !VERB_PREFIXES.has(prefix) && (prefixCounts.get(prefix) ?? 0) >= 2) return prefix
  return MISC_GROUP
}

/** Short form of a tool name inside its group (drops the MCP routing prefix). */
export function shortName(name) {
  if (!name.startsWith('mcp__')) return name
  const parts = name.slice(5).split('__')
  return parts[parts.length - 1]
}

/** First sentence of a description, capped for one-line listings. */
export function summary(text, max = 80) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  const first = flat.split(/(?<=[.!?。！？])\s/)[0] ?? ''
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

/** Rough token cost of one schema as the model receives it. */
export function estimateTokens(schema) {
  const text = JSON.stringify(schema)
  // CJK and other wide characters cost roughly one token each, not a quarter.
  let wide = 0
  for (const ch of text) if (ch.codePointAt(0) > 0x2e7f) wide += 1
  return Math.ceil((text.length - wide) / 4 + wide)
}

/** Merge every annotation that applies to `name`; later annotations win per field. */
function annotationFor(name, annotations) {
  let merged
  for (const a of annotations) {
    const hit = typeof a.match === 'string' ? a.match === name : a.match.test(name)
    if (hit) merged = { ...merged, ...a.meta }
  }
  return merged ?? {}
}

/**
 * A group a classifier renamed (e.g. attribution-scan: `phone` -> `phone-control`)
 * is unknown to category rules written for the old name. Ask the classifiers
 * about the structural groups its tools came from instead; the category covering
 * the most tools wins.
 */
function inheritedCategory(group, classifiers) {
  const byFallback = new Map()
  for (const tool of group.tools) {
    if (tool.fallbackGroup === group.name) continue
    if (!byFallback.has(tool.fallbackGroup)) byFallback.set(tool.fallbackGroup, [])
    byFallback.get(tool.fallbackGroup).push(tool)
  }
  const votes = new Map()
  for (const [name, tools] of byFallback) {
    const probe = { name, tools: tools.map(({ name: n, description, annotation }) => ({ name: n, description, annotation })) }
    const category = firstResult(classifiers, 'categorize', probe)
    if (category && category !== UNCATEGORIZED) votes.set(category, (votes.get(category) ?? 0) + tools.length)
  }
  let best
  for (const [category, count] of votes) if (!best || count > best[1]) best = [category, count]
  return best?.[0]
}

function firstResult(classifiers, method, arg) {
  for (const c of classifiers) {
    if (typeof c[method] !== 'function') continue
    try {
      const value = c[method](arg)
      if (typeof value === 'string' && value) return value
    } catch {
      // A failing classifier is skipped, never fatal.
    }
  }
  return undefined
}

/**
 * Build the directory index.
 * @param {Array<{name: string, description?: string}>} schemas - catalog tools (pinned already removed)
 * @param {object} opts
 * @param {Array} opts.classifiers - { name, priority, group?(tool), categorize?(group) }
 * @param {Array} opts.annotations - { match: string|RegExp, meta: { group?, category?, risk?, summary? } }
 * @param {Record<string,string>} opts.categories - category vocabulary (name -> description)
 * @param {string[]} opts.highRisk - tool names configured as high risk
 */
export function buildCatalog(schemas, { classifiers = [], annotations = [], categories = DEFAULT_CATEGORIES, highRisk = [] } = {}) {
  const sorted = [...classifiers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  const overrides = sorted.filter((c) => (c.priority ?? 0) >= OVERRIDE_PRIORITY)
  const ordinary = sorted.filter((c) => (c.priority ?? 0) < OVERRIDE_PRIORITY)

  const prefixCounts = new Map()
  for (const { name } of schemas) {
    const prefix = name.split('_')[0]
    if (prefix !== name) prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1)
  }

  const risky = new Set(highRisk)
  const tools = new Map()
  const groups = new Map()
  for (const schema of schemas) {
    const meta = annotationFor(schema.name, annotations)
    const probe = { name: schema.name, description: schema.description ?? '', annotation: meta }
    const group = firstResult(overrides, 'group', probe)
      ?? meta.group
      ?? firstResult(ordinary, 'group', probe)
      ?? structuralGroup(schema.name, prefixCounts)
    const entry = {
      name: schema.name,
      short: shortName(schema.name),
      group,
      // Where the structural fallback alone would have put it; a renamed group
      // inherits that group's category (see below).
      fallbackGroup: structuralGroup(schema.name, prefixCounts),
      category: UNCATEGORIZED,
      summary: meta.summary ? summary(meta.summary) : summary(schema.description),
      description: schema.description ?? '',
      tokens: estimateTokens(schema),
      highRisk: risky.has(schema.name) || meta.risk === 'high',
      annotation: meta,
    }
    tools.set(schema.name, entry)
    if (!groups.has(group)) groups.set(group, { name: group, category: UNCATEGORIZED, tools: [] })
    groups.get(group).tools.push(entry)
  }

  for (const group of groups.values()) {
    group.tools.sort((a, b) => a.short.localeCompare(b.short))
    const probe = { name: group.name, tools: group.tools.map(({ name, description, annotation }) => ({ name, description, annotation })) }
    const annotated = group.tools.map((t) => t.annotation.category).find(Boolean)
    group.category = firstResult(overrides, 'categorize', probe)
      ?? annotated
      ?? firstResult(ordinary, 'categorize', probe)
      ?? inheritedCategory(group, [...overrides, ...ordinary])
      ?? UNCATEGORIZED
    for (const tool of group.tools) tool.category = group.category
  }

  const categoryIndex = new Map()
  for (const [name, description] of Object.entries(categories)) categoryIndex.set(name, { name, description, groups: [] })
  for (const group of groups.values()) {
    if (!categoryIndex.has(group.category)) categoryIndex.set(group.category, { name: group.category, description: '', groups: [] })
    categoryIndex.get(group.category).groups.push(group)
  }
  for (const category of categoryIndex.values()) category.groups.sort((a, b) => a.name.localeCompare(b.name))

  return { tools, groups, categories: categoryIndex }
}

/**
 * Resolve a target into catalog nodes.
 * Accepts "/", "/category", "/category/group", "/category/group/tool",
 * a bare category or group name, a full tool name, or a unique short tool name.
 */
/**
 * Resolve a target string to a node.
 *
 * `resolvers` lets a plugin own a prefix (`cap:`, say): each is consulted before
 * the built-in rules and returns a list of target strings to resolve instead, or
 * undefined to pass. A plugin can therefore add a target vocabulary without the
 * core knowing anything about it.
 */
// Path segments are lowercased, but names keep their original case (an MCP
// server called "GitHub"), so lookups must not depend on it. The names stay as
// they are because persisted state stores them.
const findCI = (map, key) => map.get(key) ?? [...map.values()].find((v) => v.name.toLowerCase() === key)

export function resolveTarget(catalog, raw, resolvers = []) {
  const target = String(raw ?? '').trim()
  for (const { prefix, resolve } of resolvers) {
    if (prefix && !target.startsWith(prefix)) continue
    let expanded
    try {
      expanded = resolve(target)
    } catch {
      continue
    }
    if (expanded === undefined || expanded === null) continue
    const list = Array.isArray(expanded) ? expanded : [expanded]
    const nodes = list.map((one) => resolveTarget(catalog, one, resolvers))
    if (nodes.length === 0) return { kind: 'missing', target }
    if (nodes.length === 1) return nodes[0]
    // Several targets behind one alias: expose them as a synthetic category so
    // loading, listing and unloading all work through the existing paths.
    const tools = nodes.flatMap((node) => toolsUnder(catalog, node))
    // `aliasTools` is the exact tool list. The node's groups are copies, so
    // loading must use this list rather than subscribe to the group names —
    // otherwise a shared group would drag in every sibling tool.
    return {
      kind: 'category',
      category: { name: target, description: `Alias for ${list.join(', ')}`, groups: groupsOf(tools), alias: list, aliasTools: tools },
    }
  }
  if (target === '' || target === '/') return { kind: 'root' }
  if (catalog.tools.has(target)) return { kind: 'tool', tool: catalog.tools.get(target) }
  const parts = target.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map((p) => p.toLowerCase())
  if (parts.length === 1) {
    const [only] = parts
    const category = findCI(catalog.categories, only)
    if (category) return { kind: 'category', category }
    const group = findCI(catalog.groups, only)
    if (group) return { kind: 'group', group }
    const byShort = [...catalog.tools.values()].filter((t) => t.short.toLowerCase() === only)
    if (byShort.length === 1) return { kind: 'tool', tool: byShort[0] }
    return { kind: 'missing', target }
  }
  const [cat, grp, tool] = parts
  const category = findCI(catalog.categories, cat)
  if (!category) return { kind: 'missing', target }
  const group = category.groups.find((g) => g.name.toLowerCase() === grp)
  if (!group) return { kind: 'missing', target }
  if (parts.length === 2) return { kind: 'group', group }
  const entry = group.tools.find((t) => t.short.toLowerCase() === tool || t.name.toLowerCase() === tool)
  if (!entry || parts.length > 3) return { kind: 'missing', target }
  return { kind: 'tool', tool: entry }
}

/**
 * Regroup an exact tool list by its original group, for synthetic nodes.
 *
 * The groups are copies holding only the given tools: reusing the catalog's own
 * group objects would drag in every sibling tool, so an alias would load far
 * more than it declares.
 */
function groupsOf(tools) {
  const byName = new Map()
  for (const tool of tools) {
    if (!byName.has(tool.group)) byName.set(tool.group, { name: tool.group, category: tool.category, tools: [] })
    const group = byName.get(tool.group)
    if (!group.tools.includes(tool)) group.tools.push(tool)
  }
  return [...byName.values()]
}

/** Tools under a node (whole tree for root). */
export function toolsUnder(catalog, node) {
  if (node.kind === 'root') return [...catalog.tools.values()]
  if (node.kind === 'category') return node.category.groups.flatMap((g) => g.tools)
  if (node.kind === 'group') return node.group.tools
  if (node.kind === 'tool') return [node.tool]
  return []
}
