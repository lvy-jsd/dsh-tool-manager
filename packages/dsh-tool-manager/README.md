# @lvy-jsd/dsh-tool-manager

Browse every DeepSeek Harness tool as a directory and load tools on demand.

A DSH host with many plugins and MCP connectors sends every tool schema to the
model on every request. This plugin hides everything except a small always-on
set and gives the model three entry tools to find and load the rest:

```
tools_ls("/")                       # categories
tools_ls("/code")                   # groups (a connector or plugin)
tools_ls("/code/github")            # tools, with a one-line summary and schema size
tools_ls({ query: "pull request" }) # search the whole tree in one step
tools_load(["/code/github"])        # callable from the next step, for the rest of the session
tools_load(["mcp__github__get_me"]) # or one tool by exact name
tools_unload(["/code/github"])
```

Loaded tools are **native**: the model receives their full parameter schema
and calls them directly. Nothing is proxied.

The core ships **no placement rules**. Without an extension every group is
listed under `uncategorized/` — still fully browsable and loadable. Install
[`dsh-tool-manager-classifier-rules`](../dsh-tool-manager-classifier-rules) for
built-in rules and config overrides, or write your own classifier.

## How it works

- Visibility is a per-agent allowlist installed with the host's
  `agent.ctx.tools.restrict({ allow })`:
  `allow = (pinned ∪ loaded tools ∪ tools of loaded groups) ∩ registered tools`,
  then narrowed by any registered visibility filters.
  Tools that appear later (an MCP server reconnecting, a new plugin, a renamed
  tool) stay hidden until loaded.
- Loading a group subscribes to it: tools the group gains later become visible
  too.
- Restrictions from other plugins intersect with this one, so a hard deny (for
  example the MCP connector's governance policy) always wins.
- Every agent is restricted separately. A subagent starts from the pinned set
  plus whatever the parent loaded with `forSubagents: true`.
- Loaded state is in memory. Install
  [`dsh-tool-manager-persist`](../dsh-tool-manager-persist) to save it per
  session and restore it when the session resumes.
- If the plugin is unloaded, all its restrictions are lifted (fail open to
  "every tool visible", never to "no tools").

## Configuration

```yaml
- id: tool-manager
  name: '@lvy-jsd/dsh-tool-manager'
  config:
    pinned: []      # extra always-on tools (core DSH tools are built in)
    unpin: []       # built-in always-on tools to move into the directory
    exemptProviders: [claude-code]  # routes never narrowed (tool list fixed at session start)
    highRisk: []    # never included in group loads; load individually
```

## Extending: the `toolCatalog` service

Declare `inject: ['toolCatalog']` (or use `ctx.inject(['toolCatalog'], …)` for
an optional dependency) and register inside an effect so that unloading your
plugin undoes the registration.

### Classifiers

A classifier may place tools into groups and/or groups into categories.
Return `undefined` to pass.

```js
export const name = 'my-classifier'
export const inject = ['toolCatalog']
export function apply(ctx) {
  ctx.effect(() => ctx.toolCatalog.registerClassifier({
    name: 'my-classifier',
    priority: 200,
    group: (tool) => (tool.name.startsWith('lingshu_') ? 'lingshu' : undefined),
    categorize: (group) => (group.name === 'lingshu' ? 'system' : undefined),
  }))
}
```

Resolution order: classifiers with `priority >= 1000` (user overrides) →
plugin declarations → other classifiers, highest priority first → structural
fallback (`mcp__server__…` → `server`, shared `prefix_` → `prefix`, else
`misc`; category `uncategorized`). A classifier that throws is skipped.

### Declaring your own tools

Plugin authors know their tools best. Declare them in your `package.json`:

```json
{
  "dsh": {
    "toolCatalog": {
      "match": "^adb_",
      "group": "adb",
      "category": "device",
      "tools": { "adb_install": { "risk": "high", "summary": "Install an APK." } }
    }
  }
}
```

or at runtime:

```js
ctx.effect(() => ctx.toolCatalog.annotate('^adb_', { category: 'device' }))
ctx.effect(() => ctx.toolCatalog.annotate('adb_install', { risk: 'high' }))
```

Fields: `group`, `category`, `risk` (`"high"`), `summary`. Exact-name entries
win over `match`; runtime annotations win over `package.json`.

### New categories

```js
ctx.effect(() => ctx.toolCatalog.defineCategory('games', 'Game servers and bots'))
```

### High-risk gates

A gate declares that a plugin confirms high-risk loads (normally by returning
`{ kind: 'ask' }` from `tools/pre-execute` for `tools_load`). **With no gate
registered, high-risk tools cannot be loaded at all** — they are skipped in
group loads and refused individually. That is deliberate: a deployment without
an approval path should not be able to arm them.

```js
ctx.effect(() => ctx.toolCatalog.registerRiskGate({ name: 'my-policy' }))
ctx.effect(() => ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name !== 'tools_load' || !needsConfirmation(exec.arguments)) return next()
  return { kind: 'ask', reason: 'Loading a high-risk tool' }
}))
```

See [`dsh-tool-manager-risk-gate`](../dsh-tool-manager-risk-gate).

### Persistence

Loaded state lives in memory; a state provider makes it outlive the process.

```js
ctx.effect(() => ctx.toolCatalog.registerStateProvider({
  name: 'my-store',
  load: (agent) => readFromMyStore(agent.id),      // serialized state or null
  save: (agent, state) => writeToMyStore(agent.id, state),
}))
```

Providers are consulted in registration order (first non-null wins) and all
receive every save. `exportState(agent)` / `importState(agent, state)` are the
plain-JSON equivalents. See
[`dsh-tool-manager-persist`](../dsh-tool-manager-persist).

### Hooks

Plain Cordis events on the host context:

| Event | Kind | Payload |
|---|---|---|
| `tool-catalog/before-load` | serial; throw to veto | `{ agent, targets, names }` |
| `tool-catalog/after-load` | emit | `{ agent, targets, added }` |
| `tool-catalog/before-unload` | serial; throw to veto | `{ agent, targets }` |
| `tool-catalog/after-unload` | emit | `{ agent, targets, removed }` |
| `tool-catalog/before-rebuild` | emit | `{}` |
| `tool-catalog/after-rebuild` | emit | `{ catalog }` |
| `tool-catalog/state-changed` | emit | `{ agent, state }` (plain JSON, after every load/unload) |

```js
// A per-session quota: at most 60 visible tools.
ctx.on('tool-catalog/before-load', ({ agent, names }) => {
  const now = ctx.toolCatalog.allowFor(agent)?.length ?? 0
  if (now + names.length > 60) throw new Error('tool quota reached; unload something first')
})
```

### Visibility filters

A filter receives the agent and the computed allowlist and returns the names
to keep. It can only narrow; it can never add tools or hide the entry tools.

```js
// Keep GitHub write tools away from bot sessions.
ctx.effect(() => ctx.toolCatalog.registerVisibilityFilter({
  name: 'no-github-writes-for-bots',
  filter: (agent, names) => (agent.id.startsWith('bot-')
    ? names.filter((n) => !/^mcp__github__(create|delete|merge|push|update)/.test(n))
    : names),
}))
```

### Reading the catalog

`ctx.toolCatalog.get()` returns `{ tools, groups, categories }`;
`resolve(target)`, `stateOf(agent)`, `allowFor(agent)`, `isExempt(agent)`,
`packages()` (enabled plugin packages: `{ name, dir, manifest }`) and
`refresh()` are also available.

## Tests

See the repository root.

## License

MIT
