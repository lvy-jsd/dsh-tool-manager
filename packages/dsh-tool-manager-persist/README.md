# @lvy-jsd/dsh-tool-manager-persist

Keep loaded tools across a DSH restart for
[`dsh-tool-manager`](../dsh-tool-manager).

Without it, loaded state lives in memory only. Restart DSH mid-task and the
model has to walk the directory again. This plugin registers a **state
provider** on the `toolCatalog` service: one small JSON file per session,
written on every load/unload, read back when the session is adopted again
(resume or fork).

## Configuration

```yaml
- id: tool-manager-persist
  name: '@lvy-jsd/dsh-tool-manager-persist'
  config:
    enabled: true                                   # false disables the plugin
    dir: ~/.config/deepseek-harness/tool-manager/sessions   # default
    write: true                                     # false = restore only
```

`dir` defaults to `<DSH_HOME>/tool-manager/sessions`. Files are named after the
session id, so a session restores exactly its own state. A session with nothing
loaded gets no file; unloading everything removes it.

## What is stored

```json
{
  "loaded": ["mcp__amap__maps_weather"],
  "groups": ["adb"],
  "excluded": [],
  "handoffGroups": [],
  "handoffTools": []
}
```

Groups are stored by name, not by their current tool list, so a group that
gains tools later (an MCP server reconnecting) restores with them included.

## Writing your own store

The provider interface is the extension point; a plugin that keeps state in a
database or in the session log instead of files registers the same shape:

```js
ctx.inject(['toolCatalog'], (c) => {
  c.effect(() => c.toolCatalog.registerStateProvider({
    name: 'my-store',
    load: (agent) => readFromMyStore(agent.id),   // serialized state or null
    save: (agent, state) => writeToMyStore(agent.id, state),
  }))
})
```

Providers are consulted in registration order; the first one that returns a
state wins, and every provider receives each save. Restoring is authoritative:
it replaces what the agent would otherwise start from (pinned tools plus the
parent's handoff).

## License

MIT — see [LICENSE](LICENSE).
