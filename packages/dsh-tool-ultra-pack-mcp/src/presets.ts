// MCP server presets: well-known servers ready to switch on.
//
// Picks prefer TypeScript servers started with npx, or a hosted Streamable
// HTTP endpoint, so nothing needs Python, Go or Docker on the DSH host.
// Versions are pinned so an upstream release cannot change tools under a
// running deployment; bump them deliberately.

export type Transport = 'stdio' | 'streamable-http'

/** The config object handed to @deepseek-ai/dsh-mcp-client. */
export interface McpClientConfig {
  serverName: string
  transport: Transport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
}

export interface Need {
  /** Environment variable (or preset config key) that must be set. */
  env: string
  /** Where to get it. */
  hint: string
}

export interface PresetContext {
  /** Looks up a key in the preset's own env config, then the process env. */
  get(name: string): string | undefined
  /** The preset's own config entry. */
  options: PresetOptions
}

export interface PresetOptions {
  enabled?: boolean
  env?: Record<string, string>
  /** filesystem: directories the server may touch. */
  roots?: string[]
  /** Extra args appended to stdio servers. */
  args?: string[]
  toolCallTimeoutMs?: number
}

export interface Preset {
  id: string
  title: string
  summary: string
  category: string
  /** Upstream package or endpoint, for the README and status listing. */
  source: string
  license: string
  /** Switched on without any config when its needs are met. */
  defaultOn: boolean
  needs: Need[]
  /** Regex over the raw MCP tool name (after mcp__<id>__) for high-risk tools. */
  highRisk?: string
  build(c: PresetContext): McpClientConfig
}

const npx = (pkg: string, ...args: string[]) => ({ transport: 'stdio' as const, command: 'npx', args: ['-y', pkg, ...args] })

export const PRESETS: Preset[] = [
  {
    id: 'memory',
    title: 'Knowledge-graph memory',
    summary: 'Entities, relations and observations kept in a local JSON file across sessions.',
    category: 'memory',
    source: '@modelcontextprotocol/server-memory',
    license: 'MIT (modelcontextprotocol/servers)',
    defaultOn: true,
    needs: [],
    highRisk: '^delete_',
    build: (c) => ({
      serverName: 'memory',
      ...npx('@modelcontextprotocol/server-memory@2.0.1'),
      ...(c.get('MEMORY_FILE_PATH') ? { env: { MEMORY_FILE_PATH: c.get('MEMORY_FILE_PATH')! } } : {}),
    }),
  },
  {
    id: 'thinking',
    title: 'Sequential thinking',
    summary: 'A scratchpad tool for step-by-step reasoning with revisions and branches.',
    category: 'automation',
    source: '@modelcontextprotocol/server-sequential-thinking',
    license: 'MIT (modelcontextprotocol/servers)',
    defaultOn: true,
    needs: [],
    build: () => ({ serverName: 'thinking', ...npx('@modelcontextprotocol/server-sequential-thinking@2.0.0') }),
  },
  {
    id: 'context7',
    title: 'Context7 library docs',
    summary: 'Up-to-date documentation and code examples for libraries and frameworks.',
    category: 'code',
    source: '@upstash/context7-mcp',
    license: 'MIT',
    defaultOn: true,
    needs: [],
    build: (c) => {
      const key = c.get('CONTEXT7_API_KEY')
      return key
        ? { serverName: 'context7', transport: 'streamable-http', url: 'https://mcp.context7.com/mcp', headers: { Authorization: `Bearer ${key}` } }
        : { serverName: 'context7', ...npx('@upstash/context7-mcp@4.4.4') }
    },
  },
  {
    id: 'playwright',
    title: 'Playwright browser',
    summary: 'Drive a real headless browser: open pages, click, type, read the accessibility tree, screenshot.',
    category: 'browser',
    source: '@playwright/mcp',
    license: 'Apache-2.0',
    defaultOn: true,
    needs: [],
    highRisk: '^browser_(evaluate|file_upload|run_code)',
    build: (c) => ({ serverName: 'playwright', ...npx('@playwright/mcp@0.0.84', '--headless', '--isolated', ...(c.options.args ?? [])), toolCallTimeoutMs: 120000 }),
  },
  {
    id: 'filesystem',
    title: 'Filesystem',
    summary: 'Read, search and edit files under the directories you list (roots).',
    category: 'system',
    source: '@modelcontextprotocol/server-filesystem',
    license: 'MIT (modelcontextprotocol/servers)',
    defaultOn: true,
    needs: [{ env: 'roots', hint: 'set presets.filesystem.roots to the directories it may use' }],
    highRisk: '^(write_file|edit_file|move_file|create_directory)$',
    build: (c) => ({ serverName: 'filesystem', ...npx('@modelcontextprotocol/server-filesystem@2.1.0', ...(c.options.roots ?? [])) }),
  },
  {
    id: 'github',
    title: 'GitHub',
    summary: "GitHub's hosted MCP server: repos, issues, pull requests, Actions, code search.",
    category: 'code',
    source: 'https://api.githubcopilot.com/mcp/',
    license: 'MIT (github/github-mcp-server)',
    defaultOn: true,
    needs: [{ env: 'GITHUB_TOKEN', hint: 'a GitHub personal access token' }],
    highRisk: '^(create|delete|merge|push|update|fork|add|remove|assign|request|submit|dismiss|rerun|cancel|run)_',
    build: (c) => ({ serverName: 'github', transport: 'streamable-http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: `Bearer ${c.get('GITHUB_TOKEN')}` } }),
  },
  {
    id: 'searxng',
    title: 'SearXNG search',
    summary: 'Web search through your own SearXNG instance, plus URL reading.',
    category: 'search',
    source: 'mcp-searxng',
    license: 'MIT',
    defaultOn: true,
    needs: [{ env: 'SEARXNG_URL', hint: 'the base URL of a SearXNG instance' }],
    build: (c) => ({ serverName: 'searxng', ...npx('mcp-searxng@2.9.0'), env: { SEARXNG_URL: c.get('SEARXNG_URL')! } }),
  },
  {
    id: 'brave',
    title: 'Brave Search',
    summary: 'Web, news, image, video and local search through the Brave Search API.',
    category: 'search',
    source: '@brave/brave-search-mcp-server',
    license: 'MIT',
    defaultOn: true,
    needs: [{ env: 'BRAVE_API_KEY', hint: 'https://brave.com/search/api/' }],
    build: (c) => ({ serverName: 'brave', ...npx('@brave/brave-search-mcp-server@2.1.4'), env: { BRAVE_API_KEY: c.get('BRAVE_API_KEY')! } }),
  },
  {
    id: 'tavily',
    title: 'Tavily search',
    summary: 'Search, extract and crawl tuned for agents.',
    category: 'search',
    source: 'https://mcp.tavily.com/mcp/',
    license: 'MIT (tavily-ai/tavily-mcp)',
    defaultOn: true,
    needs: [{ env: 'TAVILY_API_KEY', hint: 'https://app.tavily.com' }],
    build: (c) => ({ serverName: 'tavily', transport: 'streamable-http', url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${encodeURIComponent(c.get('TAVILY_API_KEY')!)}` }),
  },
  {
    id: 'firecrawl',
    title: 'Firecrawl',
    summary: 'Scrape, crawl and extract structured data from websites, including JavaScript-heavy pages.',
    category: 'browser',
    source: 'firecrawl-mcp',
    license: 'MIT',
    defaultOn: true,
    needs: [{ env: 'FIRECRAWL_API_KEY', hint: 'https://firecrawl.dev' }],
    build: (c) => ({ serverName: 'firecrawl', ...npx('firecrawl-mcp@3.36.0'), env: { FIRECRAWL_API_KEY: c.get('FIRECRAWL_API_KEY')! } }),
  },
  {
    id: 'notion',
    title: 'Notion',
    summary: 'Search, read and edit Notion pages and databases.',
    category: 'collaboration',
    source: '@notionhq/notion-mcp-server',
    license: 'MIT',
    defaultOn: true,
    needs: [{ env: 'NOTION_TOKEN', hint: 'a Notion integration token (ntn_...)' }],
    highRisk: '^(API-)?(patch|post|delete|update|create|move)',
    build: (c) => ({ serverName: 'notion', ...npx('@notionhq/notion-mcp-server@2.6.1'), env: { NOTION_TOKEN: c.get('NOTION_TOKEN')! } }),
  },
  {
    id: 'amap',
    title: 'AMap (高德地图)',
    summary: 'Geocoding, POI search, routes and weather for mainland China.',
    category: 'maps',
    source: '@amap/amap-maps-mcp-server',
    license: 'ISC',
    defaultOn: true,
    needs: [{ env: 'AMAP_MAPS_API_KEY', hint: 'https://console.amap.com' }],
    build: (c) => ({ serverName: 'amap', ...npx('@amap/amap-maps-mcp-server@0.0.8'), env: { AMAP_MAPS_API_KEY: c.get('AMAP_MAPS_API_KEY')! } }),
  },
]

export type PresetStatus = 'on' | 'needs-key' | 'off'

export interface PlannedPreset {
  preset: Preset
  status: PresetStatus
  missing: Need[]
  client?: McpClientConfig
}

export interface PlanConfig {
  /** Turn on presets marked defaultOn without listing them. Default true. */
  defaults?: boolean
  presets?: Record<string, PresetOptions>
}

/** Decide which presets start, which wait for a key, and which are off. Pure. */
export function planPresets(config: PlanConfig = {}, env: Record<string, string | undefined> = process.env): PlannedPreset[] {
  const useDefaults = config.defaults !== false
  return PRESETS.map((preset) => {
    const options = config.presets?.[preset.id] ?? {}
    const wanted = options.enabled ?? (useDefaults && preset.defaultOn)
    const get = (name: string) => {
      const v = options.env?.[name] ?? env[name]
      return typeof v === 'string' && v.trim() ? v.trim() : undefined
    }
    const has = (need: Need) => (need.env === 'roots' ? Boolean(options.roots?.length) : Boolean(get(need.env)))
    const missing = preset.needs.filter((n) => !has(n))
    if (!wanted) return { preset, status: 'off' as const, missing }
    if (missing.length) return { preset, status: 'needs-key' as const, missing }
    const client = preset.build({ get, options })
    if (options.toolCallTimeoutMs) client.toolCallTimeoutMs = options.toolCallTimeoutMs
    return { preset, status: 'on' as const, missing, client }
  })
}

/** Human-readable status table, with secrets left out. */
export function describePlan(plan: PlannedPreset[], errors: Record<string, string> = {}): string {
  const lines = plan.map(({ preset: p, status, missing }) => {
    const err = errors[p.id]
    const state = err ? `failed: ${err}` : status === 'needs-key' ? `waiting for ${missing.map((m) => `${m.env} (${m.hint})`).join(', ')}` : status
    return `- ${p.id} [${p.category}] ${state}\n  ${p.title}: ${p.summary} Tools appear as mcp__${p.id}__*. Source: ${p.source}`
  })
  return `MCP presets (${plan.filter((p) => p.status === 'on' && !errors[p.preset.id]).length} on):\n${lines.join('\n')}`
}
