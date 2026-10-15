# dsh-tool-manager-risk-gate

Confirm loading high-risk tools for [`dsh-tool-manager`](../dsh-tool-manager).

Loading a tool only makes it visible; it runs nothing. That is why ordinary
loads need no confirmation. A few tools are different — merging a pull request,
deleting a file — and those are confirmed **at load time**, so the model cannot
quietly arm one and call it a step later.

## What it does

- registers a **risk gate** on `toolCatalog` (this is what tells the core a gate
  exists — without one, high-risk loads are refused outright);
- listens on `tools/pre-execute`: when a `tools_load` would load at least one
  high-risk tool, it returns `{ kind: 'ask' }`;
- DSH routes that to its approval channel. A session with no channel (headless,
  a bot without approvals) is **denied automatically** by the host — the safe
  default;
- a per-session allowlist lets a known unattended session skip the prompt.

High-risk tools are only ever loaded one at a time. Loading a whole group skips
them and tells the model to load them individually, so each confirmation is
tied to exactly one dangerous tool.

## Which tools count as high-risk

Two sources, either is enough:

1. **Declared in the catalog** — a plugin's `package.json` `dsh.toolCatalog`
   entry with `"risk": "high"`, or a runtime `annotate()` call;
2. **Listed here** — `DEFAULT_HIGH_RISK` (GitHub's `merge_pull_request`,
   `delete_file`, `delete_branch`, `create_or_update_file`, `push_files`,
   `delete_repository`) plus your `highRisk` config.

Names in the list (and in `allow`) are matched by their short name too, so
`merge_pull_request` also covers the MCP tool `mcp__github__merge_pull_request`.

The list is also annotated into the catalog (`risk: 'high'`), so the core
treats these tools as high risk everywhere: a group load skips them, and a
direct call of a hidden one is refused with a `tools_load` instruction instead
of being auto-loaded. Unloading the plugin removes the annotation.

Set `defaultHighRisk: false` to use only your own list and catalog
declarations.

## Configuration

```yaml
- id: tool-manager-risk-gate
  name: dsh-tool-manager-risk-gate
  config:
    enabled: true
    highRisk: [my_dangerous_tool]
    defaultHighRisk: true
    allow:
      # An unattended session that must load these without a prompt.
      sess_abc123: [merge_pull_request]
      sess_def456: true          # every high-risk tool in this session
```

`allow` keys are session ids. Use `true` or `"*"` for all high-risk tools in
that session, or a list of tool names. Without an entry, every high-risk load
asks — and is denied when the session has no approval channel.

## Writing your own gate

The gate is an extension point; anything that confirms a load works:

```js
ctx.inject(['toolCatalog'], (c) => {
  c.effect(() => c.toolCatalog.registerRiskGate({ name: 'my-policy' }))
})
```

Registering a gate is what re-enables high-risk loading; the confirmation
itself can come from any `tools/pre-execute` listener that returns
`{ kind: 'ask' }` (or `{ kind: 'deny' }` to refuse).

## License

MIT — see [LICENSE](LICENSE).
