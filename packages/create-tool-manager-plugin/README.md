# @lvy-jsd/create-tool-manager-plugin

Scaffold a [`dsh-tool-manager`](../dsh-tool-manager) extension.

```sh
npm create @lvy-jsd/tool-manager-plugin@latest my-ext -- --type classifier
# or, from a checkout:
node packages/create-tool-manager-plugin/lib/index.js my-ext --type classifier
```

You get a complete, working package: `package.json`, `cordis.patch.yml`,
`lib/index.js`, `README.md`, `LICENSE` and a test that already passes.

```sh
cd my-ext && npm test
```

## Types

| `--type` | Extension point | What it does |
|---|---|---|
| `classifier` (default) | `registerClassifier` | places tools into groups and groups into categories |
| `filter` | `registerVisibilityFilter` | narrows what one agent may see (can only remove names) |
| `hook` | `tool-catalog/*` events | observes or vetoes loads and unloads |
| `declaration` | `package.json` `dsh.toolCatalog` | declares group / category / risk / summary with no code |

## Usage

```
create-tool-manager-plugin <name> [--type classifier|filter|hook|declaration] [--dir <path>]

  name   package name of the new extension (kebab-case; other forms are normalized)
  --type one of the four types above (default: classifier)
  --dir  where to create it (default: ./<name>)
```

Nothing is ever overwritten: if the target already has a `package.json`, the
command refuses and exits non-zero.

## Install what you generated

```sh
dsh plugin --profile web add @lvy-jsd/dsh-tool-manager my-ext
```

Then restart DSH, or let live reload pick it up.

## The two examples in this repo

`examples/example-classifier` and `examples/example-filter` are the same shape
as generated packages and are kept working by the test suite. Read them next to
the core README's "Extending" section.

## License

MIT — see [LICENSE](LICENSE).
