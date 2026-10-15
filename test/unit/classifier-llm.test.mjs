import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir as osTmpdir } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  groupKey, readCache, writeCache, buildPrompt, parseCategory, createLlmClassifier,
  createLlmCaller, defaultCacheFile, CATEGORIES, DEFAULT_PRIORITY,
} from '../../packages/dsh-tool-manager-classifier-llm/lib/index.js'

const group = (name, tools) => ({ name, tools: tools.map(([n, d]) => ({ name: n, description: d })) })

// Every plugin test must point at a throwaway cache file: the default is
// <DSH_HOME>/tool-manager/classifier-cache.json, which is the real user config.
let scratch = null
let scratchSeq = 0
/** A fresh, empty cache file per call: tests must never share cache state. */
function scratchCache() {
  scratch ??= mkdtempSync(join(osTmpdir(), 'dsh-tm-llm-cfg-'))
  scratchSeq += 1
  return join(scratch, `cache-${scratchSeq}.json`)
}

// --- cache keys ---------------------------------------------------------------
test('key: identical groups produce the same key regardless of tool order', () => {
  const a = group('adb', [['adb_install', 'Install an APK.'], ['adb_logcat', 'Read logs.']])
  const b = group('adb', [['adb_logcat', 'Read logs.'], ['adb_install', 'Install an APK.']])
  assert.equal(groupKey(a), groupKey(b))
})

test('key: a changed description re-classifies, an unchanged one does not', () => {
  const before = group('adb', [['adb_install', 'Install an APK.']])
  const after = group('adb', [['adb_install', 'Install an APK on a device.']])
  assert.notEqual(groupKey(before), groupKey(after))
  assert.equal(groupKey(before), groupKey(group('adb', [['adb_install', 'Install an APK.']])))
})

test('key: a new tool joining a group changes the key', () => {
  const before = group('adb', [['adb_install', 'Install an APK.']])
  const after = group('adb', [['adb_install', 'Install an APK.'], ['adb_logcat', 'Read logs.']])
  assert.notEqual(groupKey(before), groupKey(after))
})

// --- cache file ---------------------------------------------------------------
test('cache: round-trips, and a corrupt file is an empty cache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tm-llm-'))
  try {
    const file = join(dir, 'nested', 'cache.json')
    writeCache(file, { abc: 'device' })
    assert.deepEqual(readCache(file), { abc: 'device' })
    writeFileSync(file, '{not json')
    assert.deepEqual(readCache(file), {}, 'a corrupt cache is not fatal')
    assert.deepEqual(readCache(join(dir, 'missing.json')), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- prompt and parsing -------------------------------------------------------
test('prompt: lists the group, its tools and the fixed vocabulary', () => {
  const text = buildPrompt(group('adb', [['adb_install', 'Install an APK.']]))
  assert.match(text, /Group name: adb/)
  assert.match(text, /- adb_install: Install an APK\./)
  for (const category of CATEGORIES) assert.ok(text.includes(category), `missing ${category}`)
})

test('parse: accepts a bare word, punctuation and prose, rejects nonsense', () => {
  assert.equal(parseCategory('device'), 'device')
  assert.equal(parseCategory('Device.'), 'device')
  assert.equal(parseCategory('The category is: maps'), 'maps')
  assert.equal(parseCategory('not-a-category'), undefined)
  assert.equal(parseCategory(''), undefined)
  // A word merely containing a category name is not a match.
  assert.equal(parseCategory('devices'), undefined)
})

// --- the classifier -----------------------------------------------------------
test('classifier: a cache hit answers synchronously and queues nothing', async () => {
  const cache = {}
  const probe = group('adb', [['adb_install', 'Install an APK.']])
  cache[groupKey(probe)] = 'device'
  const classifier = createLlmClassifier({ cache, classifyGroup: async () => 'code' })
  assert.equal(classifier.categorize(probe), 'device')
  assert.equal(classifier.pending(), 0, 'nothing queued when the cache answers')
  await classifier.drain()
  assert.equal(classifier.pending(), 0)
})

test('classifier: a miss queues the group, answers uncategorized now', async () => {
  const cache = {}
  const calls = []
  const classifier = createLlmClassifier({
    cache,
    classifyGroup: async (g) => { calls.push(g.name); return 'device' },
    onBatch: async (next) => { assert.equal(next[cacheKeyOf(g)], 'device') },
  })
  const g = group('adb', [['adb_install', 'Install an APK.']])
  const cacheKeyOf = (gg) => groupKey(gg)
  assert.equal(classifier.categorize(g), undefined, 'uncategorized until an answer lands')
  await classifier.drain()
  assert.deepEqual(calls, ['adb'])
  assert.equal(cache[groupKey(g)], 'device')
  assert.equal(classifier.categorize(g), 'device', 'answered from the cache afterwards')
})

test('classifier: one request per group, not per call', async () => {
  const cache = {}
  let calls = 0
  const classifier = createLlmClassifier({ cache, classifyGroup: async () => { calls += 1; return 'code' } })
  const g = group('github', [['gh_get', 'Get a file.']])
  for (let i = 0; i < 5; i += 1) classifier.categorize(g)
  await classifier.drain()
  assert.equal(calls, 1, 'five rebuilds, one classification')
})

test('classifier: a failing group is remembered and not retried forever', async () => {
  const cache = {}
  let calls = 0
  const classifier = createLlmClassifier({
    cache,
    classifyGroup: async () => { calls += 1; throw new Error('provider down') },
  })
  const g = group('adb', [['adb_install', 'Install an APK.']])
  classifier.categorize(g)
  await classifier.drain()
  assert.equal(calls, 1)
  classifier.categorize(g)
  await classifier.drain()
  assert.equal(calls, 1, 'a failed key is not retried in the same process')
  assert.deepEqual(classifier.failedKeys(), [groupKey(g)])
})

test('classifier: an unusable answer is not cached as a category', async () => {
  const cache = {}
  const classifier = createLlmClassifier({ cache, classifyGroup: async () => 'nonsense' })
  const g = group('adb', [['adb_install', 'Install an APK.']])
  classifier.categorize(g)
  await classifier.drain()
  assert.deepEqual(cache, {}, 'only real categories are cached')
  assert.equal(classifier.failedKeys().length, 1)
})

test('classifier: onBatch fires once per batch that produced an answer', async () => {
  const cache = {}
  let batches = 0
  const classifier = createLlmClassifier({
    cache,
    classifyGroup: async (g) => (g.name === 'bad' ? 'nope' : 'code'),
    onBatch: async () => { batches += 1 },
    batchSize: 10,
  })
  classifier.categorize(group('one', [['a', 'A']]))
  classifier.categorize(group('bad', [['b', 'B']]))
  classifier.categorize(group('two', [['c', 'C']]))
  await classifier.drain()
  assert.equal(batches, 1, 'three groups, one batch, one refresh')
  assert.equal(Object.keys(cache).length, 2)
})

test('classifier: no classify function is a no-op, not a crash', async () => {
  const classifier = createLlmClassifier({ cache: {} })
  const g = group('adb', [['adb_install', 'Install an APK.']])
  assert.equal(classifier.categorize(g), undefined)
  await classifier.drain()
  assert.equal(classifier.pending(), 0)
})

test('classifier: the pending queue is bounded', async () => {
  const classifier = createLlmClassifier({ cache: {}, classifyGroup: async () => 'code', maxPending: 2 })
  for (let i = 0; i < 5; i += 1) classifier.categorize(group(`g${i}`, [[`t${i}`, 'x']]))
  assert.ok(classifier.pending() <= 2, `pending ${classifier.pending()}`)
})

test('classifier: default priority sits below user overrides and declarations', () => {
  assert.ok(DEFAULT_PRIORITY > 0 && DEFAULT_PRIORITY < 100, 'ordinary tier')
})

// --- the LLM caller -----------------------------------------------------------
/** Minimal llm.stream() stand-in: yields text chunks then a stop finish. */
function fakeLlm(answer, { fail } = {}) {
  return {
    stream() {
      return (async function* () {
        if (fail) {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'X', message: 'boom' } } }
          return
        }
        yield { type: 'text-delta', index: 0, text: answer }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

test('caller: reads the category out of the model text', async () => {
  const call = createLlmCaller(fakeLlm('device'), { provider: 'p', model: 'm' })
  assert.equal(await call(group('adb', [['adb_install', 'Install an APK.']])), 'device')
})

test('caller: a provider error becomes a throw the classifier records', async () => {
  const call = createLlmCaller(fakeLlm('', { fail: true }), { provider: 'p', model: 'm' })
  await assert.rejects(() => call(group('adb', [['adb_install', 'Install an APK.']])), /error X: boom/)
})

// --- plugin wiring ------------------------------------------------------------
test('plugin: registers a classifier and pumps on rebuild', async () => {
  const listeners = new Map()
  const registered = []
  const ctx = {
    logger: () => ({ warn() {}, info() {} }),
    get: () => undefined,
    on: (event, handler) => { listeners.set(event, handler); return () => listeners.delete(event) },
    effect: (fn) => { const d = fn(); return d },
    toolCatalog: { registerClassifier: (c) => { registered.push(c); return () => {} }, refresh() {} },
  }
  const { default: plugin } = await import('../../packages/dsh-tool-manager-classifier-llm/lib/index.js')
  const api = plugin.apply(ctx, { classify: async () => 'code', cacheFile: scratchCache() })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'llm:groups')
  assert.equal(registered[0].priority, DEFAULT_PRIORITY)

  const g = group('adb', [['adb_install', 'Install an APK.']])
  assert.equal(registered[0].categorize(g), undefined)
  await listeners.get('tool-catalog/after-rebuild')({})
  await api.classifier.drain()
  assert.equal(registered[0].categorize(g), 'code')
})

test('plugin: enabled:false registers nothing', async () => {
  const registered = []
  const ctx = {
    logger: () => ({ warn() {}, info() {} }),
    get: () => undefined,
    on: () => () => {},
    effect: (fn) => fn(),
    toolCatalog: { registerClassifier: (c) => { registered.push(c); return () => {} }, refresh() {} },
  }
  const { default: plugin } = await import('../../packages/dsh-tool-manager-classifier-llm/lib/index.js')
  plugin.apply(ctx, { enabled: false, cacheFile: scratchCache() })
  assert.equal(registered.length, 0)
})

test('plugin: with no model configured it registers but never calls anything', async () => {
  const registered = []
  const ctx = {
    logger: () => ({ warn() {}, info() {} }),
    get: () => undefined,
    on: () => () => {},
    effect: (fn) => fn(),
    toolCatalog: { registerClassifier: (c) => { registered.push(c); return () => {} }, refresh() {} },
  }
  const { default: plugin } = await import('../../packages/dsh-tool-manager-classifier-llm/lib/index.js')
  const api = plugin.apply(ctx, { cacheFile: scratchCache() })
  const g = group('adb', [['adb_install', 'Install an APK.']])
  assert.equal(registered[0].categorize(g), undefined)
  await api.classifier.drain()
  assert.equal(registered[0].categorize(g), undefined, 'still uncategorized without a model')
})

test('plugin: the default cache file lives under DSH_HOME, not the CWD', () => {
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dsh-home-example'
  try {
    assert.equal(defaultCacheFile(), '/tmp/dsh-home-example/tool-manager/classifier-cache.json')
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
  }
})

test('plugin: answers are written to the configured cache file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tm-llm-'))
  try {
    const file = join(dir, 'cache.json')
    const ctx = {
      logger: () => ({ warn() {}, info() {} }),
      get: () => undefined,
      on: () => () => {},
      effect: (fn) => fn(),
      toolCatalog: { registerClassifier: () => () => {}, refresh() {} },
    }
    const { default: plugin } = await import('../../packages/dsh-tool-manager-classifier-llm/lib/index.js')
    const api = plugin.apply(ctx, { cacheFile: file, classify: async () => 'device' })
    const g = group('adb', [['adb_install', 'Install an APK.']])
    api.classifier.categorize(g)
    await api.classifier.drain()
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved[groupKey(g)], 'device')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
