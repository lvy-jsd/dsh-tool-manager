// Regression check for attribution-scan: on a real tool list, turning the scan
// on must not put more tools into /uncategorized than leaving it off.
// No host needed; reads plugin source read-only.
//   node test/uncategorized-check.mjs <node_modules dir>... < names.txt
// Exit 1 when the scan makes things worse.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildCatalog, UNCATEGORIZED } from '../packages/dsh-tool-manager/lib/catalog.js'
import { DEFAULT_PINNED } from '../packages/dsh-tool-manager/lib/index.js'
import { rulesClassifier, DEFAULT_GROUP_RULES, DEFAULT_GROUP_CATEGORIES, DEFAULT_PRIORITY } from '../packages/dsh-tool-manager-classifier-rules/lib/index.js'
import { scanPackages, attributionClassifier } from '../packages/dsh-tool-manager-attribution-scan/lib/index.js'

const pinned = new Set(DEFAULT_PINNED)
const names = readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter((n) => n && !pinned.has(n))
const schemas = names.map((name) => ({ name, description: '' }))

const packages = []
for (const dir of process.argv.slice(2)) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue
    const subs = entry.startsWith('@') ? readdirSync(join(dir, entry)).map((s) => `${entry}/${s}`) : [entry]
    for (const name of subs) if (existsSync(join(dir, name, 'package.json'))) packages.push({ name, dir: join(dir, name) })
  }
}

const rules = rulesClassifier({ name: 'rules:defaults', priority: DEFAULT_PRIORITY, groupRules: DEFAULT_GROUP_RULES, groupCategories: DEFAULT_GROUP_CATEGORIES })
const index = await scanPackages(packages)
const scan = attributionClassifier({ getIndex: () => index })

const uncategorized = (cat) => [...cat.tools.values()].filter((t) => t.category === UNCATEGORIZED).map((t) => t.name).sort()
const off = uncategorized(buildCatalog(schemas, { classifiers: [rules] }))
const on = uncategorized(buildCatalog(schemas, { classifiers: [rules, scan] }))
const newlyLost = on.filter((n) => !off.includes(n))
console.log(`tools ${schemas.length}, packages scanned ${packages.length}`)
console.log(`uncategorized without scan: ${off.length}`)
console.log(`uncategorized with scan:    ${on.length}`)
if (newlyLost.length) console.log(`lost their category with the scan: ${newlyLost.join(' ')}`)
process.exit(on.length > off.length ? 1 : 0)
