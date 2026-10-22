# Changelog

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
