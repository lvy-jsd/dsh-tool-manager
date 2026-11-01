# @lvy-jsd/dsh-tool-ultra-pack-mcp

Ready-made MCP servers for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra). The pack starts each preset through DSH's own MCP client (`@deepseek-ai/dsh-mcp-client`), one connection per preset. A server's tools appear as `mcp__<preset>__<tool>` and are filed under the preset's category, so they stay out of context until the model loads them with `tools_load`.

Presets that need nothing start by default. Presets that need a key or a setting wait until it is present, either in the environment or under `presets.<id>.env`. The `mcp_presets` tool lists what is running and what is waiting, and says where to get each missing key.

| Preset | Category | Starts | Source | Needs |
| --- | --- | --- | --- | --- |
| `memory` | memory | by default | `@modelcontextprotocol/server-memory` | nothing (`MEMORY_FILE_PATH` optional) |
| `thinking` | automation | by default | `@modelcontextprotocol/server-sequential-thinking` | nothing |
| `context7` | code | by default | `@upstash/context7-mcp` | nothing (`CONTEXT7_API_KEY` switches it to the hosted endpoint with higher limits) |
| `playwright` | browser | by default | `@playwright/mcp`, headless and isolated | nothing, but downloads a browser on first use |
| `filesystem` | system | when given roots | `@modelcontextprotocol/server-filesystem` | `presets.filesystem.roots` |
| `github` | code | with a token | GitHub's hosted server `api.githubcopilot.com/mcp` | `GITHUB_TOKEN` |
| `searxng` | search | with a URL | `mcp-searxng` | `SEARXNG_URL` |
| `brave` | search | with a key | `@brave/brave-search-mcp-server` | `BRAVE_API_KEY` |
| `tavily` | search | with a key | Tavily's hosted server | `TAVILY_API_KEY` |
| `firecrawl` | browser | with a key | `firecrawl-mcp` | `FIRECRAWL_API_KEY` |
| `notion` | collaboration | with a token | `@notionhq/notion-mcp-server` | `NOTION_TOKEN` |
| `amap` | maps | with a key | `@amap/amap-maps-mcp-server` (高德地图) | `AMAP_MAPS_API_KEY` |

All local presets are TypeScript servers started with `npx`, at pinned versions. GitHub and Tavily use their vendors' hosted HTTP endpoints, so there is no Go or Python on the host. Tools that write, delete or run code (GitHub writes, filesystem writes, Playwright `browser_evaluate`, Notion edits) are marked high risk, so loading them goes through the risk gate.

## Config

```yaml
- insert:
    - id: tool-ultra-pack-mcp
      name: '@lvy-jsd/dsh-tool-ultra-pack-mcp'
      config:
        defaults: true                 # start keyless presets without listing them
        presets:
          filesystem: { roots: ['/home/me/work'] }
          github: { env: { GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN } }
          playwright: { enabled: false }
          brave: { toolCallTimeoutMs: 30000 }
```

Per-preset options are `enabled`, `env`, `roots` (filesystem only), `args` (extra stdio arguments, playwright only) and `toolCallTimeoutMs`.

The host must provide `@deepseek-ai/dsh-mcp-client` (shipped DSH profiles do). If it is missing, the pack logs a warning, starts nothing, and `mcp_presets` shows why.

## License

Apache-2.0. Every server keeps its own license. They are listed in `src/presets.ts`; check them before redistributing.
