# dsh-tool-manager (monorepo)

English | [中文](README.zh.md)

On-demand tool loading for DeepSeek Harness: every tool is browsable as a
directory (category → group → tool) and only what an agent loads reaches the
model's context. Built as a small core plus replaceable extension plugins.

## Quick start

```sh
# 1. install the core plus the rule-based classifier (optional but recommended)
dsh plugin --profile web add @lvy-jsd/dsh-tool-manager @lvy-jsd/dsh-tool-manager-classifier-rules

# 2. restart DSH, then ask the agent: "what tools do you have?"
#    it answers with tools_ls("/") — a directory, not 200 tool schemas

# 3. want the UI? add the panel, then open Settings → "Tool manager"
dsh plugin --profile web add @lvy-jsd/dsh-tool-manager-panel
```

> **Install the scoped `@lvy-jsd/…` packages.** The unscoped `dsh-tool-manager`
> on npm is a different project. Do not install both: each one narrows which
> tools an agent can see, so together they hide tools from each other.

On a fresh install every group is `uncategorized` until a classifier is
installed — the tools are still browsable and loadable, only the categories are
missing. See [Extending](#extending) to write your own classifier.

| Package | What it does |
|---|---|
| [`@lvy-jsd/dsh-tool-manager`](packages/dsh-tool-manager) | Core: directory, `tools_ls` / `tools_load` / `tools_unload`, per-agent allowlist, the `toolCatalog` extension service. Without extensions every group is `uncategorized`. |
| [`@lvy-jsd/dsh-tool-manager-classifier-rules`](packages/dsh-tool-manager-classifier-rules) | Places groups into categories from built-in rules and your config overrides. |
| [`@lvy-jsd/dsh-tool-manager-risk-gate`](packages/dsh-tool-manager-risk-gate) | Confirms loading high-risk tools through the DSH approval channel, with a per-session allowlist. |
| [`@lvy-jsd/dsh-tool-manager-persist`](packages/dsh-tool-manager-persist) | Keeps loaded tools across a DSH restart, one state file per session. |
| [`@lvy-jsd/dsh-tool-manager-panel`](packages/dsh-tool-manager-panel) | Web panel: browse the tree, see each live session's loaded tools and token cost, load/unload from the UI, edit the always-on and high-risk lists, edit one tool's metadata, exempt one session. |
| [`@lvy-jsd/dsh-tool-manager-classifier-llm`](packages/dsh-tool-manager-classifier-llm) | Places groups with a small model, one request per group, cached by a hash of the group and its tool descriptions. |
| [`@lvy-jsd/dsh-tool-manager-capability-bridge`](packages/dsh-tool-manager-capability-bridge) | Load a named bundle of tools in one call: `tools_load(["cap:android-debug"])`. |
| [`@lvy-jsd/dsh-tool-manager-attribution-scan`](packages/dsh-tool-manager-attribution-scan) | Group tools by the plugin package whose source defines them. |
| [`@lvy-jsd/dsh-tool-manager-dsbot-entry`](packages/dsh-tool-manager-dsbot-entry) | A "Tool manager" row in the ds-bot settings dialog that opens the panel. |
| [`@lvy-jsd/create-tool-manager-plugin`](packages/create-tool-manager-plugin) | Scaffold your own extension: `npm create @lvy-jsd/tool-manager-plugin@latest my-ext -- --type classifier`. |

See [docs/DESIGN.md](docs/DESIGN.md) for the design.

<a id="extending"></a>
## Extending

Every feature beyond the core is an ordinary plugin using the `toolCatalog`
service, and the bundled `classifier-rules` package is written exactly as a
third party would write it. Four extension points:

| Point | For |
|---|---|
| `registerClassifier({ name, priority, group?, categorize? })` | placing tools into groups and groups into categories |
| `annotate(match, { group?, category?, risk?, summary? })` | runtime metadata; `package.json` `dsh.toolCatalog` does the same without code |
| `registerVisibilityFilter({ name, filter(agent, names) })` | narrowing what one agent may see — can only remove names |
| `registerTargetResolver({ name, prefix, resolve })` | owning a target prefix, e.g. `cap:<name>` |
| `registerRiskGate` / `registerStateProvider` | confirming high-risk loads / keeping state across a restart |

Hooks are plain events: `tool-catalog/before-load` (throw to veto),
`after-load`, `before-unload`, `after-unload`, `before-rebuild`, `after-rebuild`,
`state-changed`.

Start from a generated package — it comes with a passing test:

```sh
npm create @lvy-jsd/tool-manager-plugin@latest my-ext -- --type classifier
cd my-ext && npm test
```

Two worked examples live in [`examples/`](examples), and the full interface list
is in the core README and [docs/DESIGN.md](docs/DESIGN.md) §11.

## Develop and test

Every package is written in TypeScript (`src/`) and compiled to `lib/`
(JavaScript plus `.d.ts` type declarations); `lib/` is build output and not
committed. The root `tsconfig.json` lists the packages (project references);
the two browser halves (`client.ts`) have their own `tsconfig.client.json`,
because DSH loads them as classic scripts, not modules.

```sh
npm install                        # also links your local DSH host packages (scripts/link-host.mjs)
npm run build                      # src/*.ts -> lib/*.js + lib/*.d.ts
npm run typecheck                  # strict type check (tsc -b; writes lib/ too, references need it)
node --test test/unit/*.test.mjs   # pure catalog and registry tests (needs a build)
node test/e2e.mjs                  # boots throwaway DSH instances; never touches your profile
```

Host packages (`@deepseek-ai/*`) are peers and are never installed from the
registry (`.npmrc` sets `legacy-peer-deps`): a registry copy next to the plugin
would shadow the DSH you actually run. `npm install` links them from
`$DSH_APP` (default `~/.local/share/deepseek-harness/app`) instead.

The end-to-end test boots the shipped `headless` profile in a temporary
`DSH_HOME` once per profile (`core`, `rules`, `preset`, `persist`, `attr`,
`attr-rules`, `exempt`, `gate`, `cap`, `llm`), with
a test kit plugin and a scripted fake OpenAI-compatible model that records the
exact tool list of every model request. The panel's server half is covered by
unit tests that serve its routes over a real HTTP socket.

## License

MIT — see [LICENSE](LICENSE).
