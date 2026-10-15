import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCatalog } from '../../packages/dsh-tool-manager/lib/catalog.js'
import exampleClassifier from '../../examples/example-classifier/lib/index.js'
import exampleFilter from '../../examples/example-filter/lib/index.js'

const schemas = ['acme_deploy', 'acme_status', 'other_tool'].map((name) => ({ name, description: `${name} does a thing.` }))

/** Minimal context: effects run at once, registrations are captured. */
function makeCtx() {
  const seen = { classifiers: [], filters: [], categories: new Map() }
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    effect: (fn) => fn(),
    toolCatalog: {
      registerClassifier: (c) => { seen.classifiers.push(c); return () => {} },
      registerVisibilityFilter: (f) => { seen.filters.push(f); return () => {} },
      defineCategory: (name, description) => { seen.categories.set(name, description); return () => {} },
      refresh() {},
    },
  }
  return { ctx, seen }
}

test('example-classifier: places its tools in a group and a new category', () => {
  const { ctx, seen } = makeCtx()
  exampleClassifier.apply(ctx, {})
  assert.equal(seen.classifiers.length, 1)
  const [classifier] = seen.classifiers
  assert.equal(classifier.group({ name: 'acme_deploy' }), 'acme')
  assert.equal(classifier.group({ name: 'other_tool' }), undefined)
  assert.equal(classifier.categorize({ name: 'acme' }), 'vendor')
  assert.equal(classifier.categorize({ name: 'other' }), undefined)
  assert.ok(seen.categories.has('vendor'), 'defines the category it places tools into')

  // End to end through the real catalog builder.
  const catalog = buildCatalog(schemas, { classifiers: seen.classifiers, categories: seen.categories })
  assert.equal(catalog.tools.get('acme_deploy').category, 'vendor')
  assert.equal(catalog.tools.get('other_tool').category, 'uncategorized')
})

test('example-classifier: the config changes the prefix, group and category', () => {
  const { ctx, seen } = makeCtx()
  exampleClassifier.apply(ctx, { prefix: 'other_', group: 'others', category: 'miscellany' })
  const [classifier] = seen.classifiers
  assert.equal(classifier.group({ name: 'other_tool' }), 'others')
  assert.equal(classifier.group({ name: 'acme_deploy' }), undefined)
  assert.equal(classifier.categorize({ name: 'others' }), 'miscellany')
})

test('example-filter: removes only the names it was given', () => {
  const { ctx, seen } = makeCtx()
  exampleFilter.apply(ctx, { hide: ['other_tool'] })
  assert.equal(seen.filters.length, 1)
  const kept = seen.filters[0].filter({ id: 'sess-1' }, ['acme_deploy', 'other_tool'])
  assert.deepEqual(kept, ['acme_deploy'])
})

test('example-filter: nothing hidden means the list is untouched', () => {
  const { ctx, seen } = makeCtx()
  exampleFilter.apply(ctx, {})
  const names = ['a', 'b']
  assert.deepEqual(seen.filters[0].filter({ id: 'sess-1' }, names), names)
})

test('example-filter: a session prefix scopes the hidden list', () => {
  const { ctx, seen } = makeCtx()
  exampleFilter.apply(ctx, { hideFor: { 'bot-readonly': ['write_tool'] } })
  const filter = seen.filters[0].filter
  assert.deepEqual(filter({ id: 'bot-readonly-abc' }, ['read_tool', 'write_tool']), ['read_tool'])
  assert.deepEqual(filter({ id: 'someone-else' }, ['read_tool', 'write_tool']), ['read_tool', 'write_tool'])
})
