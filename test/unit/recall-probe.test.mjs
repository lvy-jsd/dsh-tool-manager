import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, DEFAULT_PINNED, HOST_RESERVED } from '../../packages/dsh-tool-ultra-core/lib/index.js'
import { createSearchFallback } from '../../packages/dsh-tool-ultra-classifier-llm/lib/index.js'

// Recall probe for the tool directory. It is a MEASUREMENT, not a behaviour
// test: it calls the real `toolCatalog.find()` (the same matching rule as
// `tools_ls({query})`) and records whether the expected tool can be found.
// `matchingTools()` is a case-insensitive AND-substring filter with no
// relevance ranking, so "top-1 accuracy" is meaningless here — we measure
// hit@N: is the expected tool among the returned names.

function coreHost(tools) {
  const registry = new Map(tools.map((t) => [t.name, { name: t.name, description: t.description, parameters: {} }]))
  const listeners = new Map()
  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(handler)
    return () => listeners.set(event, listeners.get(event).filter((h) => h !== handler))
  }
  const agent = { id: 's1', options: { provider: 'fake' }, ctx: { tools: { restrict: () => () => {} } } }
  const services = {}
  const effect = (fn) => fn()
  const ctx = {
    logger: () => ({ warn() {}, info() {}, debug() {} }),
    tools: {
      schemas: () => [...registry.values()],
      // The full definition is kept, so the probe can call tools_ls itself.
      register: (def) => { registry.set(def.name, def); return () => registry.delete(def.name) },
    },
    on,
    emit: (event, ...args) => { for (const h of listeners.get(event) ?? []) h(...args) },
    serial: async (event, ...args) => { for (const h of listeners.get(event) ?? []) await h(...args) },
    effect,
    provide: (name, service) => { services[name] = service },
    inject: (deps, fn) => fn({ agents: { list: () => [agent], get: () => undefined }, effect, on }),
    get: () => undefined,
  }
  apply(ctx, { sidecar: { bin: '/nonexistent' } })
  return { ctx, agent, catalog: services.toolCatalog, registry }
}

const TOOLS = [
  { name: 'browser_search', description: 'Search the web for pages and links matching a query.' },
  { name: 'web_open', description: 'Open a URL and read its text content.' },
  { name: 'web_links', description: 'Extract all hyperlinks from a page.' },
  { name: 'adb_install', description: 'Install an APK on the paired Android device.' },
  { name: 'adb_logcat', description: 'Read the Android device logcat stream.' },
  { name: 'adb_shell', description: 'Run a shell command on the paired Android device.' },
  { name: 'device_screenshot', description: 'Capture a screenshot of the paired phone.' },
  { name: 'device_battery', description: 'Report battery level of the paired phone.' },
  { name: 'music_play', description: 'Play a music track on this computer.' },
  { name: 'music_search', description: 'Find songs in the local music library.' },
  { name: 'video_transcode', description: 'Convert a video file to another format with ffmpeg.' },
  { name: 'video_thumbnail', description: 'Generate a thumbnail image from a video.' },
  { name: 'speech_transcribe', description: 'Transcribe an audio file into timestamped text.' },
  { name: 'image_understand', description: 'Describe what is inside an image using a vision model.' },
  { name: 'pdf_extract', description: 'Extract text and tables from a PDF document.' },
  { name: 'calendar_list', description: 'List upcoming calendar events.' },
  { name: 'schedule_create', description: 'Create a scheduled task that runs later.' },
  { name: 'jobs_list', description: 'List background jobs and their status.' },
  { name: 'git_status', description: 'Show changed files in the current git repository.' },
  { name: 'git_diff', description: 'Show the diff of uncommitted changes.' },
  { name: 'notes_search', description: 'Search personal notes by keyword.' },
  { name: 'contacts_lookup', description: 'Look up a contact by name or phone number.' },
  { name: 'maps_weather', description: 'Get the weather forecast for a city.' },
  { name: 'maps_directions', description: 'Get driving directions between two places.' },
]

// Two groups on purpose. Group A uses words that actually appear in the tool's
// name/description — what a keyword search can hit today. Group B is how a
// person really asks; those words are not in the schema, so AND-substring
// matching misses them. The misses are the gap a hybrid classifier should
// close. Do NOT delete group B to make the percentage look better.
// Never use a DEFAULT_PINNED name (e.g. web_search) as an expected tool: those
// are always visible and deliberately never listed in the directory.
const SAMPLES = [
  { query: 'web search', expected: 'browser_search' },
  { query: 'open url', expected: 'web_open' },
  { query: 'hyperlinks', expected: 'web_links' },
  { query: 'install apk', expected: 'adb_install' },
  { query: 'logcat', expected: 'adb_logcat' },
  { query: 'shell command device', expected: 'adb_shell' },
  { query: 'screenshot', expected: 'device_screenshot' },
  { query: 'battery level', expected: 'device_battery' },
  { query: 'play music', expected: 'music_play' },
  { query: 'find songs', expected: 'music_search' },
  { query: 'convert video format', expected: 'video_transcode' },
  { query: 'thumbnail from video', expected: 'video_thumbnail' },
  { query: 'transcribe audio', expected: 'speech_transcribe' },
  { query: 'describe image', expected: 'image_understand' },
  { query: 'extract text pdf', expected: 'pdf_extract' },
  { query: 'upcoming calendar events', expected: 'calendar_list' },
  { query: 'create scheduled task', expected: 'schedule_create' },
  { query: 'background jobs status', expected: 'jobs_list' },
  { query: 'changed files git', expected: 'git_status' },
  { query: 'uncommitted diff', expected: 'git_diff' },
  { query: 'search personal notes', expected: 'notes_search' },
  { query: 'look up contact', expected: 'contacts_lookup' },
  { query: 'weather forecast city', expected: 'maps_weather' },
  { query: 'driving directions', expected: 'maps_directions' },
  { query: "what's the weather like tomorrow", expected: 'maps_weather' },
  { query: 'send a message to my wife', expected: 'contacts_lookup' },
  { query: 'make this video smaller', expected: 'video_transcode' },
  { query: 'what did I write about taxes', expected: 'notes_search' },
  { query: 'is my phone charged', expected: 'device_battery' },
  { query: 'play something relaxing', expected: 'music_play' },
]

// The keyword path, always on: a substring match, and when that finds
// nothing, the in-process ranked index (BM25). First baseline measured
// 2026-11-05 at 24/30 = 80.0%: the 24 keyword-style samples hit, the 6
// plain-language ones missed by design. The ranked index closed four more on
// 2026-11-06 (29/30 = 96.7%) without a model, without a new tool and without
// one extra token of schema. It may only go UP: any change to search must
// report the new number in its PR (third acceptance column).
const BASELINE = 29 / 30

// The model path: when the keyword path was weak, the core asks a registered
// fallback. Here the "model" understands the one request the keyword path
// cannot read ("what did I write about taxes" -> notes_search), which is what
// a small model is there for. This measures the plumbing, not how clever the
// model is.
const SEMANTIC = { 'what did i write about taxes': 'notes_search' }

test('tools_ls query recall must not regress', async () => {
  const { catalog } = coreHost(TOOLS)
  const names = new Set(TOOLS.map((t) => t.name))
  for (const { expected } of SAMPLES) {
    assert.ok(names.has(expected), `sample expects an unregistered tool: ${expected}`)
    assert.ok(!DEFAULT_PINNED.includes(expected) && !HOST_RESERVED.includes(expected),
      `sample expects a tool that is never listed in the directory: ${expected}`)
  }

  let hits = 0
  const misses = []
  for (const { query, expected } of SAMPLES) {
    const results = catalog.find(query)
    const found = results.some((t) => t.name === expected)
    if (found) hits += 1
    else {
      misses.push(`${query} -> ${expected}`)
      console.log(`       candidates: ${results.map((t) => t.name).join(', ') || '(none)'}`)
    }
    console.log(`${found ? 'hit ' : 'miss'}  ${query}`)
  }
  const rate = hits / SAMPLES.length
  console.log(`keyword recall: ${hits}/${SAMPLES.length} = ${(rate * 100).toFixed(1)}% (baseline ${(BASELINE * 100).toFixed(1)}%)`)
  if (misses.length) console.log(`misses:\n  ${misses.join('\n  ')}`)

  assert.ok(rate >= BASELINE, `recall dropped from ${BASELINE} to ${rate}`)

  // The model path: same catalog, one fallback registered. The fallback only
  // runs when the keyword path was weak, so a clear query never reaches it.
  const { catalog: withModel, registry, agent } = coreHost(TOOLS)
  const fallback = createSearchFallback({
    pickTools: async (intent) => {
      const key = intent.trim().toLowerCase()
      return SEMANTIC[key] ? [SEMANTIC[key]] : []
    },
    candidates: () => [...withModel.get().tools.values()].map((tool) => ({ name: tool.short, summary: tool.summary })),
    lookup: (name) => {
      const catalogNow = withModel.get()
      const tool = catalogNow.tools.get(name) ?? [...catalogNow.tools.values()].find((t) => t.short === name)
      if (!tool) return undefined
      return {
        name: tool.name,
        short: tool.short,
        path: `/${tool.category}/${tool.group}/${tool.short}`,
        category: tool.category,
        group: tool.group,
        summary: tool.summary,
        tokens: tool.tokens,
        highRisk: tool.highRisk === true,
      }
    },
  })
  withModel.registerSearchFallback(fallback)
  const ls = registry.get('tools_ls')
  assert.ok(ls, 'tools_ls must be registered')
  let withModelHits = 0
  const modelMisses = []
  for (const { query, expected } of SAMPLES) {
    const out = await ls.execute({ query }, { agent })
    const found = typeof out === 'string' && out.includes(expected)
    if (found) withModelHits += 1
    else modelMisses.push(`${query} -> ${expected}`)
  }
  console.log(`model recall: ${withModelHits}/${SAMPLES.length} = ${((withModelHits / SAMPLES.length) * 100).toFixed(1)}%`)
  if (modelMisses.length) console.log(`model misses:\n  ${modelMisses.join('\n  ')}`)
  assert.equal(withModelHits, SAMPLES.length, `the model path missed: ${modelMisses.join(', ')}`)
})
