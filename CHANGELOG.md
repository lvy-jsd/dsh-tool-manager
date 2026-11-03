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
- `@lvy-jsd/dsh-tool-ultra-pack-media`: images made from code, with no model API and no key. `svg_render` renders an SVG drawing to PNG/JPEG/WebP (sharp), `chart_render` draws a Vega-Lite chart with inline data. SVG links are allowlisted (`#id` and inline images only), charts cannot load data, and files go only into the configured `outputDir` without overwriting. `music_render` turns a short score in a one-line note notation (`C4:1 [C4,E4,G4]:2 R:1`, drums `K`/`S`/`H`) into a MIDI file and a WAV from a built-in synthesizer, with no dependencies. `video_render` joins SVG scenes (with fades) and an optional soundtrack from the output folder into an H.264/AAC MP4 using the host's ffmpeg, run without a shell and with a time limit. `audio_transcribe` turns speech in an audio or video file into timestamped text and SRT subtitles with a local Whisper model (transformers.js on the CPU); `video_understand` reports a video's length, size and frame rate (ffprobe), saves a storyboard of evenly spaced frames labelled with their times, and adds the transcript. Files are read only from the output folder or configured `inputDirs`.
- Tool packs: the core's `toolCatalog.registerToolPack()` / `toolPacks()` and the `pack:<id>` target, so `tools_load(["pack:web"])` loads a whole pack. The packs register themselves, and the panel has a Packs tab with per-preset status and one-click load.
- `@lvy-jsd/dsh-tool-ultra-devices`: the device namespace. Swiftnest device tools (`device__<slug>__<capability>`) are filed under `/device/<slug>`, `device:current` / `device:all` / `device:<slug>[/<capability>]` load them, and offline devices are marked in `tools_ls`.
- Core: target resolvers receive the calling agent (so `device:current` can answer per session), and `toolCatalog.registerGroupNote()` adds short notes to group lines in `tools_ls`.
- `scripts/smoke-packs.mjs`: a live check of the packs against the real services, including starting each keyless MCP preset.

### Changed

- Works with DSH 0.2.2 (tested on 0.2.2-alpha.3) as well as 0.2.1-rc.5. DSH 0.2.2 fixes a step's callable tools when the step starts, so a direct call of a hidden ordinary tool now loads it and asks the model to call it again, instead of running in the same step. CI runs the e2e suite against both DSH versions.
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
