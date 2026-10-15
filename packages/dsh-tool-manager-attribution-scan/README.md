# dsh-tool-manager-attribution-scan

Groups tools by the plugin package that defines them, so a plugin's tools show
up together in the `tools_ls` directory even when their names share no prefix.

An extension for [`dsh-tool-manager`](../dsh-tool-manager).

## How it works

After the first catalog build, the plugin reads the source (`lib/`, `src/`,
`dist/`; never `node_modules` or tests) of every enabled plugin package once,
in the background, and indexes the string literals. Then, per tool:

1. exactly one package **defines** it (`name: '<tool>'`) → that package;
2. otherwise exactly one package **mentions** it → that package;
3. otherwise (ambiguous or unknown) → pass to the next rule.

MCP tools (`mcp__<server>__…`) are skipped; the core groups them by server.

The group name is the package name without its scope and without `stripPrefix`:
`dsh-engram` → `engram`, `@acme/dsh-notes` → `notes`.

It is an ordinary classifier at priority 10: user overrides, plugin
`package.json` declarations and `classifier-rules` (100) all win; the core's
structural fallback (shared prefix / `misc`) comes after it. A category declared
in `package.json` still applies to the attributed group.

## Install

Add the package to your DSH profile and enable its bundle patch:

```yaml
- id: tool-manager-attribution-scan
  name: dsh-tool-manager-attribution-scan
  config:
    enabled: true
    # priority: 10
    # stripPrefix: dsh-
    # exclude: []        # package names or regex strings never scanned
```

## Cost

Nothing per request: one scan per DSH start (about 1 s for ~500 packages),
off the startup path. Grouping never changes visibility — a misattributed tool
is only listed in a different place.

## License

MIT
