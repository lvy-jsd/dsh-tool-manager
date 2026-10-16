# @lvy-jsd/dsh-tool-manager-classifier-llm

Small-model classifier for [`dsh-tool-manager`](../dsh-tool-manager): it asks a
model once per tool group and caches the answer.

Optional — without it (or without a model) every group stays `uncategorized`,
which still works: the tools are browsable and loadable.

## Why it caches

The directory has to be **stable**. A category that changes between sessions
invalidates paths the model memorised, and a group moving costs another prompt
cache miss. So this classifier never classifies on the hot path:

1. `categorize(group)` is synchronous and answers from the cache file;
2. a miss is queued and the group stays `uncategorized` for now;
3. the queue is pumped **after** the catalog is built, so a rebuild never waits
   on the network;
4. when answers land they are written to the cache and `toolCatalog.refresh()`
   is called, so the next rebuild shows them.

Classification is **per group, not per call**: a host with 40 groups makes about
40 small requests in total, ever.

## Cache keys

The key is a hash of the group name plus each tool's name and a hash of its
description:

```js
groupKey(group) // sha1(name + sorted("name:sha1(description)"))[:16]
```

So a rewritten description re-classifies that group, a new tool joining the
group re-classifies it, and reordering never does. A corrupt cache file is
treated as an empty cache, never a crash.

## Configuration

```yaml
- id: tool-manager-classifier-llm
  name: '@lvy-jsd/dsh-tool-manager-classifier-llm'
  config:
    enabled: true
    # Which model classifies. Omit it and every group stays uncategorized.
    model: { provider: deepseek-official, model: deepseek-flash }
    # Defaults to <DSH_HOME>/tool-manager/classifier-cache.json
    cacheFile: ~/.config/deepseek-harness/tool-manager/classifier-cache.json
    maxTokens: 16      # the answer is one word
    batchSize: 5       # groups classified before one refresh
    priority: 50       # ordinary tier: below user overrides (1000) and declarations
```

Any model route DSH already has configured works — the plugin stores no keys.
`model: { provider, model }` is the same shape every model-using component in
this project takes (see DESIGN §2.5).

## Categories the model may choose

`device`, `code`, `media`, `maps`, `browser`, `memory`, `collaboration`,
`automation`, `connectors`, `search`, `system` — the core vocabulary, exported
as `CATEGORIES`. The model must answer with exactly one of them; anything else
is recorded as a failure and the group stays `uncategorized`.

Priority puts it **below** plugin self-declarations and user rules, so a
`package.json` `dsh.toolCatalog` entry or a `classifier-rules` override always
wins over the model.

## Writing your own classifier

The extension point is generic; a classifier is just
`{ name, priority, categorize(group) }`:

```js
ctx.effect(() => ctx.toolCatalog.registerClassifier({
  name: 'my-classifier',
  priority: 60,
  categorize: (group) => myLookup(group),   // sync; return undefined to pass
}))
```

This plugin's pieces are exported for reuse: `groupKey`, `readCache`,
`writeCache`, `buildPrompt`, `parseCategory`, `createLlmClassifier` and
`createLlmCaller`. `createLlmClassifier` takes any `classifyGroup(group)`
function, which is how the test suite runs it without a provider.

## License

MIT — see [LICENSE](LICENSE).
