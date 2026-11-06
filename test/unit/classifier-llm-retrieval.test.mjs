import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRetrievalPrompt, parseToolNames, createSearchFallback } from '../../packages/dsh-tool-ultra-classifier-llm/lib/index.js'

// The LLM retrieval fallback: the prompt, the answer parser, and the fallback
// the core calls when the keyword match was weak.

test('buildRetrievalPrompt contains the request, the tool name and the tool summary', () => {
  const prompt = buildRetrievalPrompt('send a message', [{ name: 'contacts_lookup', summary: 'Look up a contact.' }])
  assert.ok(prompt.includes('send a message'), 'must contain the request')
  assert.ok(prompt.includes('contacts_lookup'), 'must contain the tool name')
  assert.ok(prompt.includes('Look up a contact.'), 'must contain the tool summary')
})

test('parseToolNames keeps known names in the order they were named', () => {
  const result = parseToolNames('contacts_lookup, notes_search', ['contacts_lookup', 'notes_search'])
  assert.deepEqual(result, ['contacts_lookup', 'notes_search'])
})

test('parseToolNames drops unknown names', () => {
  const result = parseToolNames('contacts_lookup, rm_rf', ['contacts_lookup'])
  assert.deepEqual(result, ['contacts_lookup'])
})

test('parseToolNames caps the answer at max', () => {
  const result = parseToolNames('contacts_lookup, notes_search, maps_weather', ['contacts_lookup', 'notes_search', 'maps_weather'], 2)
  assert.deepEqual(result, ['contacts_lookup', 'notes_search'])
})

test('parseToolNames is case-insensitive', () => {
  const result = parseToolNames('CONTACTS_LOOKUP', ['contacts_lookup'])
  assert.deepEqual(result, ['contacts_lookup'])
})

test('createSearchFallback asks the model once per request', async () => {
  let calls = 0
  const fallback = createSearchFallback({
    pickTools: async () => { calls += 1; return ['notes_search'] },
    candidates: () => [{ name: 'notes_search', summary: 'Search personal notes by keyword.' }],
    lookup: (name) => (name === 'notes_search'
      ? { name: 'notes_search', short: 'notes_search', path: '/x/x/notes_search', category: 'x', group: 'x', summary: 'Search personal notes by keyword.', tokens: 10, highRisk: false }
      : undefined),
  })
  await fallback('what did I write', [])
  await fallback('what did I write', [])
  assert.equal(calls, 1, 'pickTools must be called once; the second answer comes from the cache')
})

test('createSearchFallback returns undefined when there is no pickTools', async () => {
  const fallback = createSearchFallback({
    candidates: () => [{ name: 'notes_search', summary: 'Search personal notes by keyword.' }],
  })
  const result = await fallback('what did I write', [])
  assert.equal(result, undefined)
})

test('createSearchFallback returns undefined when pickTools throws', async () => {
  const fallback = createSearchFallback({
    pickTools: async () => { throw new Error('boom') },
    candidates: () => [{ name: 'notes_search', summary: 'Search personal notes by keyword.' }],
  })
  const result = await fallback('what did I write', [])
  assert.equal(result, undefined, 'a failing pickTools must not rethrow')
})