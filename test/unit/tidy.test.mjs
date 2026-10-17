import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTidyPrompt, parseTidyAnswer, requestTidyPlan, applyTidyPlan } from '../../packages/dsh-tool-manager-panel/lib/tidy.js'

// --- prompt -------------------------------------------------------------------

const groups = [
  { name: 'adb', tools: [{ name: 'adb_install', summary: 'Install an APK.' }] },
  { name: 'maps', tools: [{ name: 'maps_search', summary: 'Search places.' }, { name: 'maps_route', description: 'Plan a route.' }] },
]

test('prompt: names every group, its tools and the allowed categories', () => {
  const text = buildTidyPrompt(groups, ['device', 'maps'])
  assert.match(text, /Categories: device, maps/)
  assert.match(text, /adb\n {2}- adb_install: Install an APK\./)
  // A tool with only a description still contributes a line.
  assert.match(text, /maps_route: Plan a route\./)
  assert.match(text, /group name => category/)
})

test('prompt: a tool with neither summary nor description is still listed', () => {
  const text = buildTidyPrompt([{ name: 'x', tools: [{ name: 'x_a' }] }], ['device'])
  assert.match(text, /x_a: \(no description\)/)
})

// --- parsing ------------------------------------------------------------------

test('parse: reads one line per group and keeps the order', () => {
  const { suggestions, rejected } = parseTidyAnswer('adb => device\nmaps => maps', groups, ['device', 'maps'], 'uncategorized')
  assert.deepEqual(suggestions.map((s) => [s.group, s.suggested]), [['adb', 'device'], ['maps', 'maps']])
  assert.deepEqual(suggestions[0].tools, ['adb_install'])
  assert.equal(suggestions[0].current, 'uncategorized')
  assert.deepEqual(rejected, [])
})

test('parse: tolerates bullets, padding and different case', () => {
  const { suggestions } = parseTidyAnswer('  - ADB  =>  Device  \n* maps => MAPS', groups, ['device', 'maps'], 'uncategorized')
  assert.deepEqual(suggestions.map((s) => [s.group, s.suggested]), [['adb', 'device'], ['maps', 'maps']])
})

test('parse: a category outside the list is rejected, not invented', () => {
  const { suggestions, rejected } = parseTidyAnswer('adb => home-automation', groups, ['device', 'maps'], 'uncategorized')
  assert.deepEqual(suggestions, [])
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason, 'not one of the listed categories')
  assert.equal(rejected[0].answer, 'home-automation')
})

test('parse: an unknown group is rejected and named', () => {
  const { suggestions, rejected } = parseTidyAnswer('nope => device', groups, ['device'], 'uncategorized')
  assert.deepEqual(suggestions, [])
  assert.equal(rejected[0].group, 'nope')
  assert.equal(rejected[0].reason, 'unknown group')
})

test('parse: prose, blank lines and a repeated group are ignored or deduped', () => {
  const text = ['Sure! Here is my answer:', '', 'adb => device', 'adb => maps', 'Thanks'].join('\n')
  const { suggestions } = parseTidyAnswer(text, groups, ['device', 'maps'], 'uncategorized')
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].suggested, 'device')
})

// --- the model call -----------------------------------------------------------

/** A stream that yields the given chunks, as the llm service does. */
function fakeLlm(chunks) {
  return {
    stream: async function* () {
      for (const chunk of chunks) yield chunk
    },
  }
}

const stop = { type: 'finish', reason: { kind: 'stop' } }
const delta = (text) => ({ type: 'text-delta', text })

test('model: a normal answer becomes a plan', async () => {
  const plan = await requestTidyPlan(fakeLlm([delta('adb => device\n'), delta('maps => maps'), stop]), {
    groups, allowed: ['device', 'maps'], current: 'uncategorized', model: { provider: 'p', model: 'm' },
  })
  assert.deepEqual(plan.suggestions.map((s) => s.group), ['adb', 'maps'])
  assert.deepEqual(plan.model, { provider: 'p', model: 'm' })
})

test('model: an error finish throws the model\'s own reason', async () => {
  await assert.rejects(
    requestTidyPlan(fakeLlm([{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow down' } } }]), {
      groups, allowed: ['device'], current: 'uncategorized', model: { provider: 'p', model: 'm' },
    }),
    /error RATE_LIMIT: slow down/,
  )
})

test('model: an aborted finish throws too', async () => {
  await assert.rejects(
    requestTidyPlan(fakeLlm([{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORT', message: 'gone' } } }]), {
      groups, allowed: ['device'], current: 'uncategorized', model: { provider: 'p', model: 'm' },
    }),
    /aborted ABORT: gone/,
  )
})

test('model: a stream with no finish chunk is an error, not a silent empty plan', async () => {
  await assert.rejects(
    requestTidyPlan(fakeLlm([delta('adb => device')]), {
      groups, allowed: ['device'], current: 'uncategorized', model: { provider: 'p', model: 'm' },
    }),
    /no finish chunk/,
  )
})

test('model: data after the finish is an error', async () => {
  await assert.rejects(
    requestTidyPlan(fakeLlm([stop, delta('more')]), {
      groups, allowed: ['device'], current: 'uncategorized', model: { provider: 'p', model: 'm' },
    }),
    /after its finish/,
  )
})

test('model: nothing to do makes no call at all', async () => {
  let called = false
  const llm = { stream: () => { called = true; throw new Error('should not be called') } }
  const plan = await requestTidyPlan(llm, { groups: [], allowed: ['device'], current: 'uncategorized', model: { provider: 'p', model: 'm' } })
  assert.equal(called, false)
  assert.deepEqual(plan.suggestions, [])
})

// --- writing ------------------------------------------------------------------

/** A catalog stub whose updateToolMeta records what was written. */
function makeCatalog() {
  const written = []
  const cat = {
    groups: new Map([
      ['adb', { name: 'adb', tools: [{ name: 'adb_install' }, { name: 'adb_uninstall' }] }],
      ['gone', { name: 'gone', tools: [{ name: 'gone_a' }] }],
    ]),
  }
  return {
    written,
    get: () => cat,
    updateToolMeta: (name, meta) => { written.push([name, meta]); return { name } },
  }
}

test('apply: writes every tool of a confirmed group', () => {
  const catalog = makeCatalog()
  const result = applyTidyPlan(catalog, [{ group: 'adb', suggested: 'device' }])
  assert.deepEqual(result.applied, [{ group: 'adb', category: 'device', tools: 2 }])
  assert.deepEqual(result.missing, [])
  assert.deepEqual(catalog.written.map(([name, meta]) => [name, meta.category]), [['adb_install', 'device'], ['adb_uninstall', 'device']])
})

test('apply: a group that vanished is reported, not fatal', () => {
  const catalog = makeCatalog()
  const result = applyTidyPlan(catalog, [{ group: 'missing', suggested: 'device' }, { group: 'adb', suggested: 'device' }])
  assert.deepEqual(result.missing, ['missing'])
  assert.deepEqual(result.applied.map((a) => a.group), ['adb'])
})

test('apply: an empty plan writes nothing', () => {
  const catalog = makeCatalog()
  const result = applyTidyPlan(catalog, [])
  assert.deepEqual(result, { applied: [], missing: [] })
  assert.deepEqual(catalog.written, [])
})
