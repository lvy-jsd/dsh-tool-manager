# Changelog

## 0.5.0 — unreleased: renamed to Tool Ultra

Every package is renamed from `@lvy-jsd/dsh-tool-manager-<name>` to
`@lvy-jsd/dsh-tool-ultra-<name>`, all at 0.5.0; the core is
`@lvy-jsd/dsh-tool-ultra-core` and the scaffolder is
`@lvy-jsd/create-dsh-tool-ultra-plugin`. The repository is now
`lvy-jsd/dsh-tool-ultra`.

### Added

- `@lvy-jsd/dsh-tool-ultra-pack-essentials`: the first native tool pack, with no API keys: `time_now`, `time_convert`, `date_diff`, `math_eval` (mathjs, with units), `weather_forecast` (Open-Meteo), `geo_search` (Nominatim) and `wiki_search` / `wiki_summary` (Wikimedia).
- `@lvy-jsd/dsh-tool-ultra-pack-web`: `web_read` (main article as Markdown via Readability + turndown) and `web_links`. Private, loopback and link-local targets are refused by default, and the check runs again on every redirect hop.
- `@lvy-jsd/dsh-tool-ultra-pack-mcp`: twelve MCP server presets started through `@deepseek-ai/dsh-mcp-client`. Keyless presets (memory, thinking, context7, playwright) start by default, keyed ones wait for their key, versions are pinned, and write tools are marked high risk. `mcp_presets` reports the status.

### Changed

- **License: Apache-2.0** from this release on. Releases up to 0.4.1 stay MIT.
- The core also provides its service as `toolUltra`; `toolCatalog` stays.

### Compatibility

- Unchanged: plugin name `tool-manager`, loader id, config keys, entry tools
  (`tools_ls` / `tools_load` / `tools_unload` / `tools_find` / `tools_route` /
  `skills_find` / `skills_route`), `tool-catalog/*` hooks, and the state
  directory `<DSH_HOME>/tool-manager/`.
- `@lvy-jsd/dsh-tool-manager` 0.5.0 re-exports the new core, so a profile that
  loads it keeps working. Do not load it and `@lvy-jsd/dsh-tool-ultra-core` together.
- Older `dsh-tool-manager-*` extension releases work with the new core through
  the unchanged `toolCatalog` service.
- `@lvy-jsd/dsh-tool-manager-dsbot-entry` is deprecated and not released again.

## 0.4.1 — 2026-11-01

Packages: `@lvy-jsd/dsh-tool-manager` 0.4.1. The other packages are unchanged.

### Fixed

- **Windows (and other non-Linux) crash on mount** (#1, fixed in #2). The bundled
  retrieval sidecar is a Linux-only binary; starting it elsewhere emitted an
  unhandled `error` event and took the DSH host down. The sidecar is now skipped
  on non-Linux platforms, spawn errors are handled, and retrieval falls back to
  the JS BM25 index.

## 0.3.0 — 2026-10-22

Packages: `@lvy-jsd/dsh-tool-manager` 0.3.0, `@lvy-jsd/dsh-tool-manager-panel` 0.2.0,
`@lvy-jsd/dsh-tool-manager-classifier-rules` 0.2.0. The other packages are unchanged.

Tested on DSH 0.2.0-rc.2 and 0.2.1-rc.2.

### Fixed

- **PTC mode** (`DSH_TOOLS_MODE=ptc`) works. The core used to catalogue the host's
  `run_code` transport as an ordinary hidden tool and refuse every call to it.

### Added

- **`[denied]` marks.** A pinned or loaded tool that another plugin still hides (MCP
  connector governance, the connector's per-session injection, any `restrict()`) is
  marked in `tools_ls`, reported as not callable by `tools_load`, and logged once.
  New service method `deniedFor(agent)`.
- **Settings page editing** (panel 0.2.0, needs core 0.3.0): edit the always-on and
  high-risk lists, view and edit a tool's metadata (group, category, risk, summary),
  exempt a single session, and tidy uncategorized groups with a model.
- **Exemption file**: `<DSH_HOME>/tool-manager/exempt.json` replaces the configured
  `exemptProviders` when present, and can exempt single sessions.
- **Catalog file** for clients that cannot lazy-load: the directory index is written
  out after every rebuild (`manifestFile`, empty to turn off).
- **Default rules for common MCP server names** (classifier-rules 0.2.0): search
  servers → `search`, email servers → a new `mail` category, browser automation
  servers → `browser`.

### Tests

- The e2e harness drives concurrent subagents (DSH 0.2.1 never waits for a child).
- New e2e runs: `deny` (another plugin's deny) and `ptc` (PTC mode).
- New unit tests: the start-up window (agents that exist before the plugin mounts) and
  the MCP-name defaults.
