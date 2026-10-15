// Prints the directory tree the core + classifier-rules would build from a real
// tool list (one name per line on stdin). No host needed.
//   node test/catalog-real.mjs [--no-rules] < names.txt
import { readFileSync } from 'node:fs'
import { buildCatalog } from '../packages/dsh-tool-manager/lib/catalog.js'
import { DEFAULT_PINNED } from '../packages/dsh-tool-manager/lib/index.js'
import { rulesClassifier, DEFAULT_GROUP_RULES, DEFAULT_GROUP_CATEGORIES } from '../packages/dsh-tool-manager-classifier-rules/lib/index.js'

const pinned = new Set(DEFAULT_PINNED)
const names = readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter((n) => n && !pinned.has(n))
const classifiers = process.argv.includes('--no-rules') ? [] : [rulesClassifier({ name: 'rules:defaults', priority: 100, groupRules: DEFAULT_GROUP_RULES, groupCategories: DEFAULT_GROUP_CATEGORIES })]
const cat = buildCatalog(names.map((name) => ({ name, description: '' })), { classifiers })
for (const category of cat.categories.values()) {
  const total = category.groups.reduce((s, g) => s + g.tools.length, 0)
  if (!total) continue
  console.log(`${category.name}/ (${total})`)
  for (const g of category.groups) console.log(`  ${g.name}/ ${g.tools.length}${g.name === 'misc' ? '  ' + g.tools.map((t) => t.name).join(' ') : ''}`)
}
