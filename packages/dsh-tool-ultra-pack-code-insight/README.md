# @lvy-jsd/dsh-tool-ultra-pack-code-insight

**Only JavaScript / TypeScript is supported** (`.js/.jsx/.mjs/.cjs` and
`.ts/.tsx/.mts/.cts`) using `@babel/parser`. Python, Rust and Go regex parsers have
been removed. Multi-language support requires a separately reviewed Tree-sitter
implementation; this release does not claim it.

## Tools

| Tool | Group / category | What it does |
| --- | --- | --- |
| `code_outline` | code / system | Top-level declarations, class methods, imports and exports; no function bodies in output. |
| `code_symbols` | code / system | Search declaration names and file/line locations. |
| `code_callgraph` | code / system | Legacy name: lists static module imports, **not function calls** or resolved cross-file semantics. |

These are structural summaries, not type checking, complete symbol resolution or
a substitute for reading the source before editing. Local parsing reads source
bodies; only the output omits them. No fixed token-saving percentage is claimed.
Unsupported file requests and malformed syntax fail explicitly. Directory scans
ignore unsupported languages and symlinks, reject more than 50 supported files
or depth over 12, and limit each regular file to 2 MB. Parse failures are reported,
not silently turned into a misleading empty outline. Host file permissions apply;
this pack is not a filesystem sandbox.

## Register and load

Build the workspace with `npm install` / `npm run build`, using `DSH_APP` to link
host peers (see root README). Add/link the package to the DSH profile's dependencies
and bundles; `cordis.patch.yml` mounts the plugin. For published versions:

```sh
dsh plugin --profile web add @lvy-jsd/dsh-tool-ultra-core @lvy-jsd/dsh-tool-ultra-pack-code-insight
```

Then `tools_load({targets:["pack:code-insight"]})` exposes the three tools through
Tool Ultra. Config: `disable`, `maxDepth` (outline request range 1–10), `maxSymbols`.

## Validation

`node --test test/unit/pack-code-insight.test.mjs` checks TS exports and methods,
JSX/CommonJS/CTS handling, unsupported-language refusal, syntax failure, symbols
and static imports. No cross-language or semantic-call-graph acceptance is implied.
