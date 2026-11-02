// Device namespace: names parse, the classifier files device tools, the
// device: resolver answers per session, and offline devices get a note.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, parseDeviceTool } from '../../packages/dsh-tool-ultra-devices/lib/index.js'

test('devices: tool names parse with either prefix', () => {
  assert.deepEqual(parseDeviceTool('device__laptop__shell_run'), { slug: 'laptop', capability: 'shell_run', area: 'shell' })
  assert.deepEqual(parseDeviceTool('mcp__swiftnest__pixel-8__screen_capture'), { slug: 'pixel-8', capability: 'screen_capture', area: 'screen' })
  assert.deepEqual(parseDeviceTool('mcp__devices__laptop__screen_capture'), { slug: 'laptop', capability: 'screen_capture', area: 'screen' }, 'transitional MCP name')
  assert.deepEqual(parseDeviceTool('device__laptop__files_read'), { slug: 'laptop', capability: 'files_read', area: 'files' })
  assert.deepEqual(parseDeviceTool('device__my_pc__files_read'), { slug: 'my_pc', capability: 'files_read', area: 'files' }, 'the first __ ends the slug')
  assert.deepEqual(parseDeviceTool('device__laptop__notify'), { slug: 'laptop', capability: 'notify', area: 'notify' })
  assert.equal(parseDeviceTool('device__Laptop__x'), undefined, 'slugs are lowercase')
  assert.equal(parseDeviceTool('mcp__github__get_me'), undefined)
  assert.equal(parseDeviceTool('devices_list'), undefined)
})

function fakeCatalog(names) {
  const reg = { classifiers: [], resolvers: [], notes: [], packs: [], refreshed: 0 }
  const catalog = {
    registerClassifier: (c) => { reg.classifiers.push(c); return () => {} },
    registerTargetResolver: (r) => { reg.resolvers.push(r); return () => {} },
    registerGroupNote: (n) => { reg.notes.push(n); return () => {} },
    registerToolPack: (p) => { reg.packs.push(p); return () => {} },
    refresh: () => { reg.refreshed += 1 },
    get: () => ({ tools: new Map(names.map((n) => [n, {}])) }),
  }
  return { catalog, reg }
}

function setup() {
  const names = ['device__laptop__shell_run', 'device__laptop__screen_capture', 'device__laptop__files_read', 'device__laptop__files_write', 'device__pixel__screen_capture', 'mcp__github__get_me']
  const { catalog, reg } = fakeCatalog(names)
  const listeners = {}
  const devices = {
    list: () => [{ slug: 'laptop', name: 'EliteBook', kind: 'desktop', online: true }, { slug: 'pixel', name: 'Pixel 8', kind: 'android', online: false, lastSeen: 'yesterday' }],
    currentFor: (sid) => (sid === 's1' ? 'laptop' : undefined),
  }
  apply({ toolCatalog: catalog, effect: (fn) => fn(), on: (e, h) => { listeners[e] = h; return () => {} }, logger: { warn() {} } }, { devices })
  return { reg, listeners }
}

test('devices: classifier files device tools under /device/<slug>', () => {
  const { reg } = setup()
  const c = reg.classifiers[0]
  assert.equal(c.group({ name: 'device__pixel__screen_capture' }), 'pixel')
  assert.equal(c.group({ name: 'mcp__github__get_me' }), undefined)
  assert.equal(c.categorize({ name: 'pixel', tools: [{ name: 'device__pixel__screen_capture' }] }), 'device')
  assert.equal(c.categorize({ name: 'github', tools: [{ name: 'mcp__github__get_me' }] }), undefined)
})

test('devices: device: targets resolve per session', () => {
  const { reg } = setup()
  const r = reg.resolvers[0]
  assert.equal(r.prefix, 'device:')
  assert.deepEqual(r.resolve('device:current', { id: 'a', session: { id: 's1' } }), ['device__laptop__files_read', 'device__laptop__files_write', 'device__laptop__screen_capture', 'device__laptop__shell_run'])
  assert.deepEqual(r.resolve('device:laptop/files'), ['device__laptop__files_read', 'device__laptop__files_write'], 'an area loads all its tools')
  assert.deepEqual(r.resolve('device:laptop/files_read'), ['device__laptop__files_read'])
  assert.deepEqual(r.resolve('device:laptop/file'), [], 'areas match whole words')
  assert.deepEqual(r.resolve('device:current', { id: 'other' }), [], 'unknown current device is a miss')
  assert.deepEqual(r.resolve('device:all/screen_capture'), ['device__laptop__screen_capture', 'device__pixel__screen_capture'])
  assert.deepEqual(r.resolve('device:pixel'), ['device__pixel__screen_capture'])
  assert.deepEqual(r.resolve('device:nope'), [])
})

test('devices: notes show the display name and offline state', () => {
  const { reg } = setup()
  const note = reg.notes[0].note
  assert.equal(note({ name: 'laptop', category: 'device' }), '(EliteBook, desktop)')
  assert.equal(note({ name: 'pixel', category: 'device' }), '(Pixel 8, android) [offline, last seen yesterday]')
  assert.equal(note({ name: 'github', category: 'code' }), undefined)
})

test('devices: a devices-changed event refreshes the catalog, and a pack lists devices', () => {
  const { reg, listeners } = setup()
  listeners['swiftnest/devices-changed']()
  assert.equal(reg.refreshed, 1)
  const items = reg.packs[0].items()
  assert.deepEqual(items.map((i) => [i.id, i.state]), [['laptop', 'on'], ['pixel', 'off']])
  assert.ok(reg.packs[0].tools[0].test('device__laptop__shell_run'))
})
