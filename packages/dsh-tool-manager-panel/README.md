# @lvy-jsd/dsh-tool-manager-panel

Web panel for [`dsh-tool-manager`](../dsh-tool-manager): browse the tool
directory, see what each live session has loaded and what it costs, and load or
unload from the UI.

Optional — the core works without it. When the deployment has no web server
(headless), the plugin mounts nothing and stays harmless.

## What you get

| View | Shows | Actions |
|---|---|---|
| **Directory** | the same category → group → tool tree the model browses, with per-node tool counts and schema tokens, plus each tool's summary and high-risk mark | click to drill down; `load` on any node; search across the whole tree from the search box |
| **Sessions** | every live agent (subagents marked with their parent), its loaded groups and tools, how many tools are visible (`exempt` for a route listed in `exemptProviders`, which is never narrowed), and the **schema tokens actually sent** for it | `load` / `unload` per agent |
| **Configuration** | the effective always-on list, config additions, and the high-risk list, plus every registered extension point (classifiers with priorities, visibility filters, risk gates, state providers, categories) | read-only in v1 |

Loading from the panel goes through the **same path as `tools_load`**, so
`tool-catalog/before-load` hooks and vetoes apply. The risk gate's approval
prompt does not: it guards the model's `tools_load` call, and a click in the
panel is itself the user's consent. Without any risk gate installed, high-risk
loads are still refused.

## Install

```sh
dsh plugin --profile web add @lvy-jsd/dsh-tool-manager @lvy-jsd/dsh-tool-manager-classifier-rules @lvy-jsd/dsh-tool-manager-panel
```

Then restart DSH (or let live reload pick it up). Open **Settings**: a **Tool
manager** section (工具管理 in Chinese) appears in the settings sidebar.

The panel follows the DSH interface language (English and Chinese, English by
default; category names and descriptions are translated) and the active theme,
light or dark, because it is styled only with the host's `--dsw-alias-*` theme
variables.

```yaml
- id: tool-manager-panel
  name: '@lvy-jsd/dsh-tool-manager-panel'
  config:
    enabled: true   # false disables the routes (the settings section then reports the service offline)
```

## How it is put together

Two halves:

- **Server half** (`src/index.ts`) mounts two same-origin routes under a
  loopback + same-origin trust fence (the same shape `dsh-mcp-connector` uses):

  | Route | Purpose |
  |---|---|
  | `POST /tool-manager/api` | JSON-RPC with a method whitelist (`tree`, `sessions`, `load`, `unload`, `config`, `extensions`, `search`) |
  | `GET /tool-manager/events` | SSE: catalog rebuilt, per-session state changed |

- **Browser half** (`src/client.ts`) is a small
  `window.__ModuleLoader__.load({...})` registration, compiled by `tsc` into a
  classic script (`lib/client.js`) — no bundler. It registers
  one `settings.section` slot and renders the panel natively with React (no
  iframe). Copy lives in two dictionaries registered with the host `locale`
  service; styles use only `--dsw-alias-*` variables, so any DSH theme applies.

To add a language, add a dictionary next to `en` and `zh` in `src/client.ts`
and register it under the same namespace (`tool-manager.panel`).

## Writing your own panel

Every method reads from the `toolCatalog` service, so a different UI needs no
core changes:

```js
ctx.inject(['toolCatalog'], (c) => {
  const tree = c.toolCatalog.get()               // catalog for an agent (or the union)
  const rows = c.toolCatalog.agents()            // live agents with parents
  const state = c.toolCatalog.stateOf(agent)     // { loaded, groups, … } (Sets)
  const tokens = c.toolCatalog.wireTokens(agent) // schema tokens really sent
  const hits = c.toolCatalog.find('adb')         // structured cross-tree search
  await c.toolCatalog.load(agent, ['/device/adb'])   // same path as tools_load
})
```

## License

MIT — see [LICENSE](LICENSE).
