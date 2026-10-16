// dsh-tool-manager: browse every DSH tool as a directory tree
// (category -> group -> tool) and load tools on demand per agent.
//
// Loaded tools are native: the model receives their full parameter schema.
// Visibility is enforced with the host's per-agent `tools.restrict({ allow })`.
//
// The core ships no placement rules: without a classifier plugin every group
// is `uncategorized`. Placement, metadata, hooks and extra visibility narrowing
// are provided by other plugins through the `toolCatalog` service.

import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildCatalog, resolveTarget, toolsUnder, UNCATEGORIZED } from './catalog.js'
import { createVisibilityController } from './visibility.js'
import { createRegistries, readManifestAnnotations, listPluginPackages } from './service.js'
import type { Agent, Annotation, Catalog, CatalogNode, CoreConfig, Disposer, HostContext, Logger, RiskGate, SerializedState, ToolCatalogService, ToolEntry, ToolSchema } from './types.js'

export type * from './types.js'
export { buildCatalog, resolveTarget, toolsUnder, estimateTokens, summary, shortName, structuralGroup, DEFAULT_CATEGORIES, UNCATEGORIZED, MISC_GROUP, OVERRIDE_PRIORITY } from './catalog.js'
export type { BuildOptions } from './catalog.js'
export type { RegisteredClassifier, RegisteredFilter } from './service.js'
export type { VisibilityController, VisibilityOptions } from './visibility.js'

export const name = 'tool-manager'
export const inject = ['tools']

export const ENTRY_TOOLS = ['tools_ls', 'tools_load', 'tools_unload']

// Always visible and never listed in the directory. Names the host does not
// have are ignored, so this list survives DSH renames. Config `pinned` adds to
// it; config `unpin` removes from it.
export const DEFAULT_PINNED = [
  // DSH core
  'bash', 'read', 'write', 'edit', 'str_replace_editor', 'glob', 'grep', 'read_image',
  'ask_user_question', 'ask_user', 'exit_plan_mode', 'workflow', 'todo_write', 'present', 'skill', 'plan',
  'web_fetch', 'web_search', 'job_list', 'job_output', 'job_kill', 'create_goal', 'get_goal', 'update_goal',
  // delegation
  'subagent', 'subagent_fork', 'list_subagent_models', 'wait_agent', 'interrupt_agent', 'list_agents',
  // memory lookup is small and frequent
  'recall',
  // team chat: a Bot's group prompt tells it to answer through these, so they
  // must never sit behind tools_load
  'group_relay', 'post_to_group', 'read_group_chat', 'read_own_chat', 'message_bot', 'list_bots',
]

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

function fmtTokens(n: number): string {
  return n >= 1000 ? `~${(n / 1000).toFixed(1)}k tok` : `~${n} tok`
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text + ' '.repeat(width - text.length)
}

export function apply(ctx: HostContext, config: CoreConfig = {}) {
  const logger: Logger = (typeof ctx.logger === 'function' ? ctx.logger('tool-manager') : ctx.logger) ?? console
  // Model routes whose tool list is handed to an external client once per
  // session and never refreshed (Claude Code receives DSH tools through an MCP
  // bridge at startup). Narrowing such a session hides tools it can then never
  // load, and the client already lazy-loads schemas itself (ToolSearch), so
  // these agents are left unrestricted. Config `exemptProviders` replaces the
  // default list; [] restricts every route.
  const exemptProviders = new Set(config.exemptProviders ?? ['claude-code'])

  /** The route an agent's next request will use: latest model/selection, else its options. */
  const selectionScan = new WeakMap<object, { seq: number, provider: string | undefined }>() // session -> incremental scan
  function providerOf(agent: Agent): string | undefined {
    const session = agent?.session
    try {
      if (session && typeof session.eventAt === 'function' && Number.isInteger(session.seq)) {
        const memo = selectionScan.get(session) ?? { seq: 0, provider: undefined }
        for (let seq = memo.seq; seq < session.seq!; seq += 1) {
          const event = session.eventAt(seq)
          if (event?.type === 'model/selection' && event.data?.provider) memo.provider = event.data.provider
        }
        memo.seq = session.seq!
        selectionScan.set(session, memo)
        if (memo.provider) return memo.provider
      }
    } catch {
      // fall back to the agent's options
    }
    return agent?.options?.provider ?? session?.requestHeader?.()?.provider
  }

  // High-risk tools can be loaded individually only while at least one risk
  // gate (e.g. dsh-tool-manager-risk-gate) is registered; the gate confirms the
  // load before it executes. With no gate, high-risk loads are refused.
  const riskGates = new Set<{ name: string }>()

  const pinnedSet = () => {
    const set = new Set([...DEFAULT_PINNED, ...(config.pinned ?? [])])
    for (const n of config.unpin ?? []) set.delete(n)
    for (const n of ENTRY_TOOLS) set.add(n)
    return set
  }

  // --- catalog -----------------------------------------------------------------
  // The directory is built per agent: global tools plus tools registered in the
  // agent's ancestor scopes (its preset). In the DSH web profile most tools
  // live in a preset layer, so a global-only catalog would hide them without
  // listing them. Agents with the same tool set share one cached catalog.
  const catalogs = new Map<string, Catalog>()  // key (sorted names) -> catalog
  let manifestAnnotations: Annotation[] | null = null
  const invalidate = () => { catalogs.clear() }
  const registries = createRegistries(() => {
    invalidate()
    visibility?.refresh()
  })

  function schemaOf(definition: { description?: string, parameters?: unknown }, name: string): ToolSchema {
    try {
      if (typeof ctx.tools.schemaOf === 'function') return ctx.tools.schemaOf(definition, false)
    } catch {
      // fall through to the public fields
    }
    return { name, description: definition.description ?? '', parameters: definition.parameters ?? {} }
  }

  /** Schemas of tools an agent inherits from its ancestor (preset) layers. */
  function inheritedSchemas(agent: Agent | undefined): ToolSchema[] {
    const layers = ctx.tools.layers
    if (!agent || typeof layers?.chainLayers !== 'function') return []
    const own = layers.peek?.(agent)
    const out: ToolSchema[] = []
    for (const layer of layers.chainLayers(agent)) {
      if (layer === own) continue
      for (const [name, definition] of layer.tools.entries()) out.push(schemaOf(definition, name))
    }
    return out
  }

  /** Catalog for one agent, or for the union of all live agents when omitted. */
  const getCatalog = (agent?: Agent): Catalog => {
    const pinned = pinnedSet()
    const byName = new Map<string, ToolSchema>(ctx.tools.schemas().map((s) => [s.name, s]))
    for (const a of agent ? [agent] : visibility.agents()) {
      for (const s of inheritedSchemas(a)) if (!byName.has(s.name)) byName.set(s.name, s)
    }
    const schemas = [...byName.values()].filter((s) => !pinned.has(s.name))
    const key = schemas.map((s) => s.name).sort().join('\n')
    const cached = catalogs.get(key)
    if (cached) return cached
    ctx.emit('tool-catalog/before-rebuild', {})
    manifestAnnotations ??= readManifestAnnotations(ctx, logger)
    const catalog = buildCatalog(schemas, {
      classifiers: [...registries.classifiers],
      // Package declarations first, runtime annotate() after, so runtime wins.
      annotations: [...manifestAnnotations, ...registries.annotations],
      categories: Object.fromEntries(registries.categories),
      highRisk: config.highRisk ?? [],
    })
    catalogs.set(key, catalog)
    ctx.emit('tool-catalog/after-rebuild', { catalog })
    return catalog
  }

  const visibility = createVisibilityController(ctx, {
    pinned: () => [...pinnedSet()],
    entryTools: ENTRY_TOOLS,
    getFilters: () => [...registries.filters],
    getCatalog,
    // The catalog is rebuilt lazily after any registry change.
    invalidate,
    onStateChange: (agent, state) => ctx.emit('tool-catalog/state-changed', { agent, state }),
    isExempt: (agent) => {
      const provider = providerOf(agent)
      return provider !== undefined && exemptProviders.has(provider)
    },
    logger,
  })

  if (typeof ctx.inject === 'function') {
    ctx.inject(['agents'], (agentCtx) => {
      agentCtx.effect(() => visibility.mount(agentCtx), 'tool-manager.visibility()')
    })
  } else {
    logger.warn?.('tool-manager: host has no ctx.inject; per-agent visibility is disabled')
  }
  ctx.effect(() => () => visibility.dispose(), 'tool-manager.dispose()')

  // Rescue a direct call of a hidden tool (see rescueHiddenCall). Runs before
  // dispatch resolves the name, so loading here makes the call succeed.
  ctx.effect(() => ctx.on('tools/pre-execute', async (exec: { agent?: Agent, name: string } | undefined, next: () => unknown) => {
    const agent = exec?.agent
    if (!agent || pinnedSet().has(exec!.name) || ENTRY_TOOLS.includes(exec!.name)) return next()
    const refusal = await rescueHiddenCall(agent, exec!.name)
    if (refusal !== undefined) return { kind: 'deny', reason: refusal }
    return next()
  }), 'tool-manager.rescue-hidden-call()')

  // --- the toolCatalog service ---------------------------------------------------
  const service = {
    registerClassifier: registries.registerClassifier,
    annotate: registries.annotate,
    defineCategory: registries.defineCategory,
    registerVisibilityFilter: registries.registerVisibilityFilter,
    /**
     * Own a target prefix (`"cap:"`) in tools_load / tools_ls / tools_unload.
     * `resolve(target)` returns one or more ordinary targets to resolve
     * instead, or undefined to pass. Returns a disposer.
     */
    registerTargetResolver: registries.registerTargetResolver,
    /**
     * Let loaded state outlive the process (DSH restart). `load(agent)` returns
     * a serialized state or null, `save(agent, state)` receives plain JSON.
     * Returns a disposer. See dsh-tool-manager-persist.
     */
    registerStateProvider: visibility.registerStateProvider,
    /**
     * Declare that a plugin confirms high-risk loads (normally by returning
     * {kind:'ask'} from tools/pre-execute for tools_load). Returns a disposer.
     */
    registerRiskGate(gate: RiskGate = {}): Disposer {
      const entry = { name: gate.name ?? 'anonymous' }
      riskGates.add(entry)
      return () => { riskGates.delete(entry) }
    },
    riskGates: () => [...riskGates].map((g) => g.name),
    /** Re-read package declarations and rebuild. */
    refresh() {
      manifestAnnotations = null
      invalidate()
      visibility.refresh()
    },
    /** Catalog as one agent sees it, or the union over live agents. */
    get: (agent?: Agent) => getCatalog(agent),
    resolve: (target: string, agent?: Agent) => resolveTarget(getCatalog(agent), target, [...registries.resolvers]),
    /** Loaded state of one agent: { loaded, groups, excluded, handoffGroups, handoffTools } (Sets). */
    stateOf: (agent: Agent) => visibility.stateOf(agent),
    /** Plain JSON of an agent's loaded state, for persistence plugins. */
    exportState: (agent: Agent) => visibility.exportState(agent),
    /** Replace an agent's loaded state (e.g. restored after a restart). */
    importState: (agent: Agent, state: Partial<SerializedState>) => visibility.importState(agent, state),
    allowFor: (agent: Agent) => visibility.allowFor(agent),
    /** True when the agent's model route is in `exemptProviders` (never narrowed). */
    isExempt: (agent: Agent) => visibility.isExempt(agent),
    /**
     * Load/unload on behalf of an agent, through the same path as the entry
     * tools (hooks, vetoes, risk gates and persistence all apply). Returns the
     * same text the model would see. Intended for UI plugins such as
     * dsh-tool-manager-panel.
     */
    load: (agent: Agent, targets: readonly string[], options?: LoadOptions) => loadTargets(agent, targets, options),
    unload: (agent: Agent, targets: readonly string[]) => unloadTargets(agent, targets),
    /** Live agents, each with its parent when it is a subagent. */
    agents: () => {
      // The parent lookup goes through the injected agents API: the plugin ctx
      // itself does not inject `agents`, and reading it there throws.
      return visibility.agents().map((agent) => {
        const parent = visibility.parentOf(agent)
        return { agent, id: String(agent.id), parentId: parent ? String(parent.id) : null }
      })
    },
    /** Effective configuration, for UI display. */
    config: () => ({
      pinned: [...pinnedSet()],
      entryTools: [...ENTRY_TOOLS],
      extraPinned: config.pinned ?? [],
      unpinned: config.unpin ?? [],
      highRisk: config.highRisk ?? [],
    }),
    /** Enabled plugin packages on this host: `{ name, dir, manifest }[]`. */
    packages: () => listPluginPackages(ctx),
    /** Registered extension points, so a UI can show what is active. */
    extensions: () => ({
      classifiers: [...registries.classifiers].map((c) => ({ name: c.name, priority: c.priority ?? 0 })),
      filters: [...registries.filters].map((f) => f.name),
      annotations: registries.annotations.map((a) => ({ source: a.source, match: String(a.match) })),
      categories: [...registries.categories.keys()],
      riskGates: [...riskGates].map((g) => g.name),
      stateProviders: visibility.stateProviders(),
    }),
    /**
     * Structured cross-directory search for UIs: the same matching rules as
     * tools_ls(query), returned as data instead of text.
     */
    find: (query: string, path = '/') => {
      const cat = getCatalog()
      const node = resolveTarget(cat, path, [...registries.resolvers])
      if (node.kind === 'missing') return []
      return matchingTools(cat, node, query).slice(0, 200).map((tool) => ({
        name: tool.name,
        short: tool.short,
        path: `/${tool.category}/${tool.group}/${tool.short}`,
        category: tool.category,
        group: tool.group,
        summary: tool.summary,
        tokens: tool.tokens,
        highRisk: tool.highRisk === true,
      }))
    },
    /** Schema tokens actually sent for an agent: pinned tools plus its loaded set. */
    wireTokens: (agent: Agent) => {
      const visible = new Set(visibility.allowFor(agent) ?? [])
      const cat = getCatalog(agent)
      let tokens = 0
      for (const schema of ctx.tools.schemas(agent)) {
        if (!visible.has(schema.name)) continue
        tokens += cat.tools.get(schema.name)?.tokens ?? 0
      }
      return tokens
    },
  } satisfies ToolCatalogService
  ctx.provide('toolCatalog', service)

  // --- direct calls of a hidden tool -----------------------------------------------
  //
  // A tool this plugin hid is still a registered tool: the model may call it by
  // name, and the host would answer "unknown tool" — which reads like a broken
  // plugin and, for a protocol tool a plugin's own prompt tells the model to
  // use, breaks the feature outright (a group Bot replying through group_relay,
  // for instance).
  //
  // So a direct call of a hidden tool is handled here, before dispatch:
  //   - an ordinary tool is loaded on the spot and the call proceeds;
  //   - a high-risk tool is refused with the exact load instruction, so it still
  //     has to go through the risk gate and its approval.
  // The cost is a few tokens when the model skips the directory; the benefit is
  // that forgetting to pin a protocol tool degrades instead of breaking.
  async function rescueHiddenCall(agent: Agent, name: string): Promise<string | undefined> {
    // allowFor() is null for an agent this plugin does not track (and for one
    // whose context cannot restrict at all): nothing to rescue there.
    if (visibility.allowFor(agent) === null) return undefined
    const state = visibility.stateOf(agent)
    if (state.loaded.has(name)) return undefined
    // Only tools this plugin manages: pinned tools and entry tools are always
    // visible, and anything else is hidden by the host or another plugin, which
    // is not ours to override.
    const catalog = getCatalog(agent)
    const tool = catalog.tools.get(name)
    if (!tool) return undefined
    if (tool.highRisk) {
      return `"${name}" is high risk and is not loaded. Load it first with tools_load(["${name}"]), which asks for approval.`
    }
    // An auto-load is still a load: a before-load veto must stop it too.
    try {
      await ctx.serial('tool-catalog/before-load', { agent, targets: [name], names: [name], rescue: true })
    } catch (error) {
      return `Load of "${name}" refused: ${errorText(error)}`
    }
    visibility.update(agent, (next) => {
      next.loaded.add(name)
      next.excluded.delete(name)
    })
    // A visibility filter (or a connector deny) may still keep it out; say so
    // rather than letting the host report an unknown tool.
    if (!(visibility.allowFor(agent) ?? []).includes(name)) {
      // Undo the load, or a tool the session cannot see would sit in its state
      // (and be persisted) as if it had been loaded.
      visibility.update(agent, (next) => { next.loaded.delete(name) })
      return `"${name}" is not available in this session. Use tools_ls to see what is.`
    }
    ctx.emit('tool-catalog/auto-loaded', { agent, name })
    return undefined
  }

  // --- listing -------------------------------------------------------------------
  function visibleSetFor(agent: Agent | undefined): Set<string> | null {
    const allow = agent ? visibility.allowFor(agent) : null
    return allow ? new Set(allow) : null
  }

  function toolLine(tool: ToolEntry, visible: Set<string> | null, withPath = false): string {
    const marks = `${visible?.has(tool.name) ? '*' : ' '}${tool.highRisk ? '!' : ' '}`
    const label = withPath ? `/${tool.category}/${tool.group}/${tool.short}` : tool.short
    return `  ${marks} ${pad(label, withPath ? 48 : 34)}${pad(fmtTokens(tool.tokens), 11)}${tool.summary}`
  }

  function listing(cat: Catalog, node: CatalogNode, visible: Set<string> | null): string {
    const count = (tools: readonly ToolEntry[]) => ({
      n: tools.length,
      loaded: tools.filter((t) => visible?.has(t.name)).length,
      tokens: tools.reduce((s, t) => s + t.tokens, 0),
    })
    const lines: string[] = []
    if (node.kind === 'root') {
      lines.push('/  (categories; * = loaded, ! = high risk; tools_ls with query searches everything)')
      for (const category of cat.categories.values()) {
        const c = count(category.groups.flatMap((g) => g.tools))
        if (c.n === 0 && category.name !== UNCATEGORIZED) continue
        lines.push(`  ${pad(`${category.name}/`, 16)}${pad(`${c.n} tools`, 10)}${pad(`${c.loaded} loaded`, 11)}${pad(fmtTokens(c.tokens), 11)}${category.description}`)
      }
    } else if (node.kind === 'category') {
      lines.push(`/${node.category.name}/  ${node.category.description}`)
      for (const group of node.category.groups) {
        const c = count(group.tools)
        lines.push(`  ${pad(`${group.name}/`, 22)}${pad(`${c.n} tools`, 10)}${pad(`${c.loaded} loaded`, 11)}${fmtTokens(c.tokens)}`)
      }
    } else if (node.kind === 'group') {
      lines.push(`/${node.group.category}/${node.group.name}/`)
      for (const tool of node.group.tools) lines.push(toolLine(tool, visible))
    } else if (node.kind === 'tool') {
      const t = node.tool
      lines.push(`/${t.category}/${t.group}/${t.short}`, `  name: ${t.name}`, `  ${t.summary}`, `  schema ${fmtTokens(t.tokens)}${t.highRisk ? ' · high risk: load it on its own' : ''}${visible?.has(t.name) ? ' · loaded' : ''}`)
    }
    return lines.join('\n')
  }

  /** Tools under `node` matching every word of `query` (name, group, category, description). */
  function matchingTools(cat: Catalog, node: CatalogNode, query: unknown): ToolEntry[] {
    const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return toolsUnder(cat, node).filter((t) => {
      const hay = `${t.name} ${t.group} ${t.category} ${t.description}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }

  function search(cat: Catalog, node: CatalogNode, query: string, visible: Set<string> | null): string {
    const hits = matchingTools(cat, node, query)
    if (!hits.length) return `No tools match "${query}".`
    const shown = hits.slice(0, 40)
    return [`${hits.length} match(es) for "${query}" (load by path or full name):`, ...shown.map((t) => toolLine(t, visible, true)), hits.length > shown.length ? `  … ${hits.length - shown.length} more; narrow the query or the path` : ''].filter(Boolean).join('\n')
  }

  function agentOf(exec: { agent?: unknown } | undefined): Agent {
    if (!exec?.agent) throw new Error('tool-manager: this tool must be called by an agent')
    return exec.agent as Agent
  }

  // --- load / unload (shared by the entry tools and the toolCatalog service) -------

  /**
   * Subscribe an agent to targets. Runs the before-load hook (which may veto) and
   * returns the model-facing text; the panel calls this same path, so hooks
   * apply identically; risk-gate approval does not, since a panel click is
   * itself the user's consent.
   */
  async function loadTargets(agent: Agent, targets: readonly string[], { forSubagents = false }: LoadOptions = {}): Promise<string> {
    const cat = getCatalog(agent)
    const nodes = targets.map((raw) => ({ raw, node: resolveTarget(cat, raw, [...registries.resolvers]) }))
    const names = nodes.flatMap(({ node }) => (node.kind === 'root' || node.kind === 'missing' ? [] : toolsUnder(cat, node).map((t) => t.name)))
    try {
      await ctx.serial('tool-catalog/before-load', { agent, targets, names })
    } catch (error) {
      return `Load refused: ${errorText(error)}`
    }
    const before = new Set(visibility.allowFor(agent) ?? [])
    const notes: string[] = []
    visibility.update(agent, (state) => {
      for (const { raw, node } of nodes) {
        if (node.kind === 'missing' || node.kind === 'root') {
          notes.push(`skipped ${raw}: ${node.kind === 'root' ? 'cannot load the whole tree' : 'not found (try tools_ls with query)'}`)
          continue
        }
        // An alias (e.g. a capability pack) names exact tools: add those, never
        // the whole group they happen to live in.
        if (node.kind === 'category' && node.category.aliasTools) {
          for (const tool of node.category.aliasTools) {
            if (tool.highRisk && riskGates.size === 0) {
              notes.push(`${tool.name} is high risk and no risk gate is installed to confirm it; not loaded`)
              continue
            }
            state.loaded.add(tool.name)
            state.excluded.delete(tool.name)
            if (forSubagents) state.handoffTools.add(tool.name)
          }
          continue
        }
        const groups = node.kind === 'category' ? node.category.groups : node.kind === 'group' ? [node.group] : []
        for (const group of groups) {
          state.groups.add(group.name)
          if (forSubagents) state.handoffGroups.add(group.name)
          for (const tool of group.tools) state.excluded.delete(tool.name)
          const risky = group.tools.filter((t) => t.highRisk).map((t) => t.short)
          if (risky.length) notes.push(`${group.name}: high-risk tools not included (${risky.join(', ')}); load them one by one`)
        }
        if (node.kind === 'tool') {
          if (node.tool.highRisk && riskGates.size === 0) {
            notes.push(`${node.tool.name} is high risk and no risk gate is installed to confirm it; not loaded`)
            continue
          }
          state.loaded.add(node.tool.name)
          state.excluded.delete(node.tool.name)
          if (forSubagents) state.handoffTools.add(node.tool.name)
        }
      }
    })
    const after = visibility.allowFor(agent) ?? []
    const added = after.filter((n) => !before.has(n))
    ctx.emit('tool-catalog/after-load', { agent, targets, added })
    const tokens = added.reduce((sum, n) => sum + (cat.tools.get(n)?.tokens ?? 0), 0)
    return [
      added.length ? `Loaded ${added.length} tool(s), ${fmtTokens(tokens)}; callable from your next step:` : 'Nothing new loaded.',
      ...added.map((n) => `  ${n}`),
      ...notes,
    ].join('\n')
  }

  /** Hide targets again. Returns the model-facing text. */
  async function unloadTargets(agent: Agent, targets: readonly string[]): Promise<string> {
    const cat = getCatalog(agent)
    try {
      await ctx.serial('tool-catalog/before-unload', { agent, targets })
    } catch (error) {
      return `Unload refused: ${errorText(error)}`
    }
    const before = new Set(visibility.allowFor(agent) ?? [])
    visibility.update(agent, (state) => {
      for (const raw of targets) {
        if (String(raw).trim().toLowerCase() === 'all') {
          for (const set of Object.values(state)) set.clear()
          continue
        }
        const node = resolveTarget(cat, raw, [...registries.resolvers])
        if (node.kind === 'category' && node.category.aliasTools) {
          for (const tool of node.category.aliasTools) {
            state.loaded.delete(tool.name)
            state.handoffTools.delete(tool.name)
          }
          continue
        }
        const groups = node.kind === 'category' ? node.category.groups : node.kind === 'group' ? [node.group] : []
        for (const group of groups) {
          state.groups.delete(group.name)
          state.handoffGroups.delete(group.name)
          for (const tool of group.tools) state.loaded.delete(tool.name)
        }
        if (node.kind === 'tool') {
          state.loaded.delete(node.tool.name)
          state.handoffTools.delete(node.tool.name)
          if (state.groups.has(node.tool.group)) state.excluded.add(node.tool.name)
        }
      }
    })
    const after = new Set(visibility.allowFor(agent) ?? [])
    const removed = [...before].filter((n) => !after.has(n))
    ctx.emit('tool-catalog/after-unload', { agent, targets, removed })
    return removed.length ? `Unloaded ${removed.length} tool(s):\n${removed.map((n) => `  ${n}`).join('\n')}` : 'Nothing was unloaded.'
  }

  // --- tools -----------------------------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'tools_ls',
    description:
      'Browse every available tool as a directory: / lists categories, /<category> lists groups (a connector or plugin), /<category>/<group> lists tools with a one-line summary and schema size. Tools marked * are loaded (callable now). Most tools are hidden until loaded with tools_load. Pass query to search names and descriptions across the whole tree (or under path) in one step.',
    parameters: {
      path: { type: 'string', description: 'Directory path such as "/", "/code", "/code/github", or a group or tool name. Default "/".' },
      query: { type: 'string', description: 'Search words matched against tool name, group, category and description; searches everything under path.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const cat = getCatalog(exec?.agent as Agent | undefined)
      const node = resolveTarget(cat, args.path ?? '/', [...registries.resolvers])
      if (node.kind === 'missing') return `No such path: ${node.target}. Start from tools_ls("/") or search with tools_ls({query}).`
      const visible = visibleSetFor(exec?.agent as Agent | undefined)
      return args.query ? search(cat, node, args.query, visible) : listing(cat, node, visible)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'tools_load',
    description:
      'Make tools callable for the rest of this session. Each target is a group path ("/code/github"), a category ("/maps"), or one tool by path or exact name ("mcp__github__get_file_contents"). Loading a group also includes tools the group gains later. Prefer one group load over many single tools. Loaded tools are available from your next step. Set forSubagents to also hand these targets to subagents you start afterwards.',
    parameters: {
      targets: { type: 'array', items: { type: 'string' }, required: true, description: 'Paths, group names or exact tool names.' },
      forSubagents: { type: 'boolean', description: 'Also give these targets to subagents started from now on.' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      return loadTargets(agentOf(exec), args.targets ?? [], { forSubagents: args.forSubagents === true })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'tools_unload',
    description:
      'Hide loaded tools again to keep context small. Targets use the same forms as tools_load; "all" returns to the always-on set. Always-on tools cannot be unloaded.',
    parameters: {
      targets: { type: 'array', items: { type: 'string' }, required: true, description: 'Paths, group names, exact tool names, or "all".' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      return unloadTargets(agentOf(exec), args.targets ?? [])
    },
  }))
}

/** Options for toolCatalog.load / tools_load. */
export interface LoadOptions {
  /** Also hand the targets to subagents started afterwards. */
  forSubagents?: boolean
}

/** The message of a thrown value, whatever was thrown. */
function errorText(error: unknown): string {
  return String((error as { message?: unknown } | null | undefined)?.message ?? error)
}

export default { name, inject, apply }
