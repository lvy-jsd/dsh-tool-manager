import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCatalog, resolveTarget, UNCATEGORIZED } from '../../packages/dsh-tool-manager/lib/catalog.js'
import { createRegistries, packageNameOf } from '../../packages/dsh-tool-manager/lib/service.js'
import {
  rulesClassifier, groupCategoriesFrom, DEFAULT_GROUP_RULES, DEFAULT_GROUP_CATEGORIES, USER_PRIORITY, DEFAULT_PRIORITY,
} from '../../packages/dsh-tool-manager-classifier-rules/lib/index.js'

const schemas = [
  'adb_install', 'adb_logcat', 'create_bot', 'list_bots', 'mcp__amap__maps_weather',
  'mcp__gork__android__mobile_tap', 'lingshu_cg', 'lingshu_stg', 'list_models',
].map((name) => ({ name, description: `${name} does things. More text.` }))

const defaults = rulesClassifier({ name: 'rules:defaults', priority: DEFAULT_PRIORITY, groupRules: DEFAULT_GROUP_RULES, groupCategories: DEFAULT_GROUP_CATEGORIES })
const category = (cat, tool) => cat.tools.get(tool).category
const group = (cat, tool) => cat.tools.get(tool).group

test('core alone: structural groups, everything uncategorized', () => {
  const cat = buildCatalog(schemas)
  for (const tool of cat.tools.values()) assert.equal(tool.category, UNCATEGORIZED)
  assert.equal(group(cat, 'adb_install'), 'adb')
  assert.equal(group(cat, 'mcp__amap__maps_weather'), 'amap')
  assert.equal(group(cat, 'mcp__gork__android__mobile_tap'), 'gork-android')
  assert.equal(group(cat, 'create_bot'), 'misc', 'verb prefixes never form a group')
})

test('rules plugin defaults place known groups', () => {
  const cat = buildCatalog(schemas, { classifiers: [defaults] })
  assert.equal(category(cat, 'adb_install'), 'device')
  assert.equal(group(cat, 'create_bot'), 'bots')
  assert.equal(category(cat, 'list_bots'), 'collaboration')
  assert.equal(category(cat, 'mcp__amap__maps_weather'), 'maps')
  assert.equal(category(cat, 'lingshu_cg'), UNCATEGORIZED, 'unknown groups stay uncategorized')
})

test('plugin declaration beats default rules', () => {
  const cat = buildCatalog(schemas, {
    classifiers: [defaults],
    annotations: [{ match: /^adb_/, meta: { category: 'code' } }],
  })
  assert.equal(category(cat, 'adb_install'), 'code')
})

test('declared group and summary are used', () => {
  const cat = buildCatalog(schemas, {
    annotations: [{ match: /^lingshu_/, meta: { group: 'lingshu-engine', category: 'system', summary: 'Lingshu engine. Extra.' } }],
  })
  assert.equal(group(cat, 'lingshu_cg'), 'lingshu-engine')
  assert.equal(category(cat, 'lingshu_stg'), 'system')
  assert.equal(cat.tools.get('lingshu_cg').summary, 'Lingshu engine.')
})

test('user override beats plugin declaration', () => {
  const user = rulesClassifier({ name: 'rules:user', priority: USER_PRIORITY, groupCategories: groupCategoriesFrom({ media: { groups: ['adb'] } }) })
  const cat = buildCatalog(schemas, {
    classifiers: [defaults, user],
    annotations: [{ match: /^adb_/, meta: { category: 'code' } }],
  })
  assert.equal(category(cat, 'adb_install'), 'media')
})

test('risk: declaration or config marks high risk', () => {
  const cat = buildCatalog(schemas, {
    annotations: [{ match: 'adb_install', meta: { risk: 'high' } }],
    highRisk: ['list_models'],
  })
  assert.equal(cat.tools.get('adb_install').highRisk, true)
  assert.equal(cat.tools.get('list_models').highRisk, true)
  assert.equal(cat.tools.get('adb_logcat').highRisk, false)
})

test('a throwing classifier is skipped', () => {
  const bad = { name: 'bad', priority: 500, categorize() { throw new Error('boom') } }
  const cat = buildCatalog(schemas, { classifiers: [bad, defaults] })
  assert.equal(category(cat, 'adb_install'), 'device')
})

test('resolveTarget: paths, group names, exact and short tool names', () => {
  const cat = buildCatalog(schemas, { classifiers: [defaults] })
  assert.equal(resolveTarget(cat, '/device/adb').kind, 'group')
  assert.equal(resolveTarget(cat, 'amap').kind, 'group')
  assert.equal(resolveTarget(cat, 'mcp__amap__maps_weather').tool.name, 'mcp__amap__maps_weather')
  assert.equal(resolveTarget(cat, 'maps_weather').tool.name, 'mcp__amap__maps_weather')
  assert.equal(resolveTarget(cat, '/maps/amap/maps_weather').kind, 'tool')
  assert.equal(resolveTarget(cat, '/nope').kind, 'missing')
})

test('registries: register/dispose notify, filters validated', () => {
  let changes = 0
  const r = createRegistries(() => { changes += 1 })
  const off = r.registerClassifier({ name: 'x', categorize: () => 'code' })
  const offAnn = r.annotate('^a', { category: 'code', bogus: 1 })
  const offCat = r.defineCategory('games', 'Game tools')
  assert.equal(r.classifiers.size, 1)
  assert.deepEqual(r.annotations[0].meta, { category: 'code' })
  assert.equal(r.categories.get('games'), 'Game tools')
  off(); offAnn(); offCat(); off()
  assert.equal(r.classifiers.size, 0)
  assert.equal(r.annotations.length, 0)
  assert.equal(r.categories.has('games'), false)
  assert.equal(changes, 6, 'each register and each first dispose notifies once')
  assert.throws(() => r.registerClassifier({ name: 'empty' }))
  assert.throws(() => r.registerVisibilityFilter({ name: 'empty' }))
})

test('packageNameOf handles scoped and subpath specifiers', () => {
  assert.equal(packageNameOf('@scope/pkg/sub'), '@scope/pkg')
  assert.equal(packageNameOf('dsh-adb'), 'dsh-adb')
  assert.equal(packageNameOf('@deepseek-ai/dsh-tool-subagent/list-agents'), '@deepseek-ai/dsh-tool-subagent')
})

test('a renamed group inherits the category of the structural group its tools came from', () => {
  const tools = ['zap_one', 'zap_two', 'zap_three', 'lingshu_cg', 'lingshu_stg'].map((name) => ({ name, description: '' }))
  const rename = { name: 'rename', priority: 10, group: (t) => (t.name.startsWith('zap_') ? 'zap-plugin' : t.name.startsWith('lingshu_') ? 'lingshu-plugin' : undefined) }
  const rules = { name: 'rules', priority: 100, categorize: (g) => ({ zap: 'device' })[g.name] }
  const cat = buildCatalog(tools, { classifiers: [rules, rename] })
  assert.equal(group(cat, 'zap_one'), 'zap-plugin')
  assert.equal(category(cat, 'zap_one'), 'device', 'zap -> device carries over to zap-plugin')
  assert.equal(category(cat, 'lingshu_cg'), UNCATEGORIZED, 'nothing to inherit stays uncategorized')
  // A rule for the new name still wins over inheritance.
  const named = { name: 'named', priority: 100, categorize: (g) => ({ 'zap-plugin': 'media', zap: 'device' })[g.name] }
  assert.equal(category(buildCatalog(tools, { classifiers: [named, rename] }), 'zap_one'), 'media')
})
