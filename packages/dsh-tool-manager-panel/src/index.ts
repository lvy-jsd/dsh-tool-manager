// dsh-tool-manager-panel: a web UI for dsh-tool-manager.
//
// Server half. Mounts two same-origin routes under a loopback/same-origin
// trust fence, the same shape dsh-mcp-connector uses for its market UI:
//
//   POST /tool-manager/api      JSON-RPC with a method whitelist
//   GET  /tool-manager/events   SSE: catalog rebuilt, agent state changed
//
// The browser half (src/client.ts) renders the panel natively as a section of
// the Settings page and talks to these routes. When the deployment has no web
// server (headless), this plugin mounts nothing and stays harmless.

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { Agent, Disposer, ExtensionContext, HostContext, Logger, ToolCatalogService, ToolEntry } from 'dsh-tool-manager'

/** The part of the host's webServer service (dsh-host-webserver WebRoute) this plugin uses. */
export interface WebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** A context that has injected `webServer`. */
export interface WebContext extends Pick<HostContext, 'effect'>, Partial<Pick<HostContext, 'get' | 'on'>> {
  webServer: WebServer
}

/** One directory node as the browser receives it. */
export interface NodeJson {
  kind: 'root' | 'category' | 'group' | 'tool' | 'missing'
  path: string
  name?: string
  short?: string
  description?: string
  summary?: string
  toolCount?: number
  tokens?: number
  highRisk?: boolean
  category?: string
  group?: string
  children?: NodeJson[]
}

/** Parameters of the API methods (untrusted JSON from the browser). */
export interface ApiParams {
  path?: string
  query?: string
  sessionId?: unknown
  targets?: string[]
  forSubagents?: boolean
}

interface SseClient {
  res: ServerResponse
  send(event: string, data: unknown): unknown
}

export const name = 'tool-manager-panel'
export const inject = ['toolCatalog']

const PREFIX = '/tool-manager'

const header = (headers: IncomingHttpHeaders | undefined, key: string): string | undefined => (Array.isArray(headers?.[key]) ? headers[key][0] : headers?.[key])

function parseAuthority(host: unknown): { hostname: string, host: string } | undefined {
  if (typeof host !== 'string' || host.length === 0) return undefined
  try {
    const url = new URL(`http://${host}`)
    return url.hostname ? { hostname: url.hostname, host: url.host } : undefined
  } catch {
    return undefined
  }
}

const isLoopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost')

/**
 * Browser trust fence: loopback (or a declared trusted host), not cross-site,
 * and same-origin when an Origin header is present.
 */
export function isTrustedWebRequest(request: { headers?: IncomingHttpHeaders }, trustedHosts: unknown[] = []): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  const trusted = (trustedHosts ?? []).some((raw) => {
    const authority = typeof raw === 'string' ? parseAuthority(raw) : undefined
    return authority !== undefined && authority.host === hostUrl.host
  })
  if (!isLoopback(hostUrl.hostname) && !trusted) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 1024 * 1024) throw new Error('request body exceeds 1 MiB')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.trim() ? JSON.parse(text) : {}
}

/**
 * One directory node as plain JSON for the browser. Every node has the same
 * shape — `{ kind, path, name, description?, toolCount, tokens, highRisk?,
 * children?, tool? }` — so the UI can render any depth with one loop.
 */
function nodeJson(service: ToolCatalogService, path: string): NodeJson {
  const cat = service.get()
  const node = service.resolve(path)
  if (node.kind === 'missing') return { kind: 'missing', path }
  if (node.kind === 'root') {
    return {
      kind: 'root',
      path: '/',
      toolCount: cat.tools.size,
      tokens: sum([...cat.tools.values()]),
      children: [...cat.categories.values()].map((category) => {
        const tools = category.groups.flatMap((g) => g.tools)
        return {
          kind: 'category',
          name: category.name,
          path: `/${category.name}`,
          description: category.description,
          toolCount: tools.length,
          tokens: sum(tools),
        }
      }),
    }
  }
  if (node.kind === 'category') {
    const tools = node.category.groups.flatMap((g) => g.tools)
    return {
      kind: 'category',
      name: node.category.name,
      path: `/${node.category.name}`,
      description: node.category.description,
      toolCount: tools.length,
      tokens: sum(tools),
      children: node.category.groups.map((group) => ({
        kind: 'group',
        name: group.name,
        path: `/${node.category.name}/${group.name}`,
        toolCount: group.tools.length,
        tokens: sum(group.tools),
      })),
    }
  }
  if (node.kind === 'group') {
    return {
      kind: 'group',
      name: node.group.name,
      path: `/${node.group.category}/${node.group.name}`,
      toolCount: node.group.tools.length,
      tokens: sum(node.group.tools),
      children: node.group.tools.map((tool) => ({ ...toolJson(tool), kind: 'tool', path: `/${tool.category}/${tool.group}/${tool.short}` })),
    }
  }
  return { kind: 'tool', path, ...toolJson(node.tool) }
}

const sum = (tools: ToolEntry[]) => tools.reduce((total, t) => total + t.tokens, 0)

const toolJson = (tool: ToolEntry) => ({
  name: tool.name,
  short: tool.short,
  summary: tool.summary,
  tokens: tool.tokens,
  toolCount: 1,
  highRisk: tool.highRisk === true,
  category: tool.category,
  group: tool.group,
})

/** Find a live agent by session id. */
function findAgent(catalog: ToolCatalogService, sessionId: unknown): Agent | null {
  const wanted = String(sessionId ?? '')
  for (const entry of catalog.agents()) if (entry.id === wanted) return entry.agent
  return null
}

/**
 * The JSON-RPC facade behind POST /tool-manager/api. Every method reads from the
 * toolCatalog service, so the panel sees exactly what the model sees.
 */
export function createApi(catalog: ToolCatalogService) {
  return {
    /** One directory node (or the root) for the Directory view. */
    tree({ path }: ApiParams = {}) {
      return { root: nodeJson(catalog, path ?? '/') }
    },
    /** Live agents with loaded state and real token usage. */
    sessions() {
      const rows = []
      for (const { agent, id, parentId } of catalog.agents()) {
        const state = catalog.stateOf(agent)
        // An exempt route is never narrowed, so it has no allowlist to count.
        const exempt = catalog.isExempt?.(agent) === true
        rows.push({
          id,
          parentId,
          exempt,
          visible: exempt ? null : (catalog.allowFor(agent) ?? []).length,
          wireTokens: catalog.wireTokens(agent),
          loadedTools: [...state.loaded].sort(),
          groups: [...state.groups].sort(),
          handoffGroups: [...state.handoffGroups].sort(),
          handoffTools: [...state.handoffTools].sort(),
        })
      }
      return { sessions: rows }
    },
    /** Load for one agent through the core, so hooks and risk gates apply. */
    async load({ sessionId, targets, forSubagents }: ApiParams = {}) {
      const agent = findAgent(catalog, sessionId)
      if (!agent) return { ok: false, message: `no live session ${sessionId}` }
      const message = await catalog.load(agent, targets ?? [], { forSubagents: forSubagents === true })
      return { ok: true, message }
    },
    /** Unload for one agent through the core. */
    async unload({ sessionId, targets }: ApiParams = {}) {
      const agent = findAgent(catalog, sessionId)
      if (!agent) return { ok: false, message: `no live session ${sessionId}` }
      const message = await catalog.unload(agent, targets ?? [])
      return { ok: true, message }
    },
    /** Effective configuration (read-only in v1). */
    config() {
      return { config: catalog.config(), editable: false, note: 'Editing from the panel is not implemented yet; use the plugin config.' }
    },
    /** Registered extension points, so a user can see what is active. */
    extensions() {
      return catalog.extensions()
    },
    /** Cross-directory search: the same matching as tools_ls(query), as data. */
    search({ query, path }: ApiParams = {}) {
      return { results: catalog.find(query ?? '', path ?? '/') }
    },
  }
}

/** Push an event to every open panel, dropping clients that error. */
function broadcast(clients: Set<SseClient>, event: string, data: unknown): void {
  for (const client of clients) {
    try {
      client.send(event, data)
    } catch {
      clients.delete(client)
    }
  }
}

/**
 * Mount the two same-origin routes. `wctx` is a context that has injected
 * `webServer` (and, when present, `webRuntime` for the trusted-host list).
 * Returns a disposer that unmounts all of them.
 */
export function mountWebRoutes(wctx: WebContext, catalog: ToolCatalogService, { logger }: { logger?: Logger } = {}): Disposer {
  const api = createApi(catalog)
  // `webRuntime` is optional: read it through get() so a context that injected
  // only `webServer` does not throw on service access.
  const trustedHosts = () => {
    const runtime = (typeof wctx.get === 'function' ? wctx.get('webRuntime') : undefined) as { trustedHosts?: unknown[] } | undefined
    return runtime?.trustedHosts ?? []
  }
  const fence = (request: IncomingMessage) => isTrustedWebRequest(request, trustedHosts())
  const clients = new Set<SseClient>()

  const apiDisposer = wctx.webServer.register({
    kind: 'prefix',
    path: `${PREFIX}/api`,
    handler: async (req, res) => {
      if (!fence(req)) return writeJson(res, 403, { ok: false, message: 'forbidden' })
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      try {
        const body = await readJsonBody(req) as { method?: unknown, params?: ApiParams } | null
        const dispatch = API_WHITELIST.get(body?.method)
        if (!dispatch) return writeJson(res, 400, { ok: false, message: `unknown method "${body?.method ?? ''}"` })
        writeJson(res, 200, { ok: true, ...(await dispatch(api, body?.params ?? {})) })
      } catch (error) {
        logger?.warn?.(`tool-manager-panel api error: ${(error as Error | undefined)?.message ?? error}`)
        writeJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  const eventsDisposer = wctx.webServer.register({
    kind: 'prefix',
    path: `${PREFIX}/events`,
    handler: async (req, res) => {
      if (!fence(req)) return writeJson(res, 403, { ok: false, message: 'forbidden' })
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-content-type-options': 'nosniff',
      })
      const client: SseClient = { res, send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
      clients.add(client)
      client.send('ready', { at: Date.now() })
      const ping = setInterval(() => client.send('ping', { at: Date.now() }), 25_000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(client)
      })
    },
  })

  // Keep open panels current: rebuilds and per-session state changes.
  const stops: (Disposer | undefined)[] = [
    wctx.on?.('tool-catalog/after-rebuild', () => broadcast(clients, 'catalog', { at: Date.now() })),
    wctx.on?.('tool-catalog/state-changed', ({ agent, state }) => broadcast(clients, 'state', { sessionId: String(agent?.id ?? ''), state })),
  ]

  return () => {
    for (const stop of stops) stop?.()
    for (const client of clients) client.res.end()
    clients.clear()
    apiDisposer?.()
    eventsDisposer?.()
  }
}

type PanelApi = ReturnType<typeof createApi>

// Keyed by the untrusted `method` field, so lookups take any value.
const API_WHITELIST = new Map<unknown, (api: PanelApi, params: ApiParams) => object | Promise<object>>([
  ['tree', (api, params) => api.tree(params)],
  ['sessions', (api) => api.sessions()],
  ['load', (api, params) => api.load(params)],
  ['unload', (api, params) => api.unload(params)],
  ['config', (api) => api.config()],
  ['extensions', (api) => api.extensions()],
  ['search', (api, params) => api.search(params)],
])

export function apply(ctx: ExtensionContext & { inject(deps: string[], fn: (wctx: WebContext) => void): void }, config: { enabled?: boolean } = {}) {
  const logger = (typeof ctx.logger === 'function' ? ctx.logger('tool-manager-panel') : ctx.logger) ?? console
  if (config.enabled === false) return
  ctx.inject(['webServer'], (wctx) => {
    wctx.effect(() => mountWebRoutes(wctx, ctx.toolCatalog, { logger }), 'tool-manager-panel.routes()')
    logger.info?.('tool-manager-panel: mounted /tool-manager/api and /tool-manager/events')
  })
}

export default { name, inject, apply }
