// Media pack: SVG safety allowlist, rendering, charts without external data, and file output.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { apply, checkSvg, createTools, safeBaseName, saveFile, TOOL_NAMES } from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#3b82f6"/></svg>'
const BARS = {
  data: { values: [{ fruit: 'apple', n: 3 }, { fruit: 'pear', n: 7 }] },
  mark: 'bar',
  encoding: { x: { field: 'fruit', type: 'nominal' }, y: { field: 'n', type: 'quantitative' } },
}

const tempDir = () => mkdtempSync(join(tmpdir(), 'pack-media-'))
const tool = (config, name) => createTools(config).find((t) => t.name === name)
const savedPath = (message) => message.slice(message.indexOf(': ') + 2)

test('media: tools match the package.json catalog; disable and pack registration work', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../packages/dsh-tool-ultra-pack-media/package.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(pkg.dsh.toolCatalog.tools).sort(), [...TOOL_NAMES].sort())
  const registered = []
  const packs = []
  const ctx = {
    tools: { register: (d) => registered.push(d.name) },
    inject: (_deps, fn) => fn({ toolCatalog: { registerToolPack: (p) => packs.push(p) }, effect: (f) => f() }),
  }
  apply(ctx, { disable: ['chart_render'] })
  assert.deepEqual(registered, ['svg_render', 'music_render'])
  assert.equal(packs[0].id, 'media')
  assert.deepEqual(packs[0].tools, ['svg_render', 'music_render'])
})

test('media: checkSvg allows #id links and inline images', () => {
  const ok = [
    SVG,
    '<?xml version="1.0"?><!-- card --><svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/><use href="#g"/></svg>',
    '<svg width="1" height="1"><image xlink:href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/></svg>',
  ]
  for (const svg of ok) assert.doesNotThrow(() => checkSvg(svg, 10_000), svg)
})

test('media: checkSvg refuses anything that could reach a file or the network', () => {
  const refused = [
    ['<svg><image href="file:///etc/passwd"/></svg>', /links to "file:\/\/\/etc\/passwd"/],
    ['<svg><image xlink:href="https://evil.example/x.png"/></svg>', /links to/],
    ['<svg><image href="photo.png"/></svg>', /links to "photo\.png"/],
    ['<svg><rect style="fill:url(https://evil.example/p)"/></svg>', /links to/],
    ['<svg><style>@import "https://evil.example/a.css";</style></svg>', /@import/],
    ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>', /DTDs/],
    ['<svg><script>alert(1)</script></svg>', /scripts/],
    ['<svg><foreignObject><p>hi</p></foreignObject></svg>', /scripts and embedded/],
    ['<html><svg></svg></html>', /must start with <svg>/],
  ]
  for (const [svg, reason] of refused) assert.throws(() => checkSvg(svg, 10_000), reason, svg)
  assert.throws(() => checkSvg(SVG, 10), /larger than 10 bytes/)
})

test('svg_render: saves a PNG at the drawing size or the requested width', async () => {
  const dir = tempDir()
  const render = tool({ outputDir: dir }, 'svg_render')
  const plain = await render.execute({ svg: SVG, name: 'blue box!' })
  assert.match(plain, /^Saved PNG 200×100 \(\d+ KB\): .*blue-box-\d{8}T\d{6}Z\.png$/)
  const wide = await render.execute({ svg: SVG, width: 800, format: 'webp' })
  const meta = await sharp(savedPath(wide)).metadata()
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 800, 400])
  assert.equal(readdirSync(dir).length, 2)
})

test('svg_render: refuses bad arguments and oversized output', async () => {
  const render = tool({ outputDir: tempDir(), maxPixels: 100_000 }, 'svg_render')
  await assert.rejects(render.execute({ svg: SVG, format: 'gif' }), /format must be one of png, jpeg, webp/)
  await assert.rejects(render.execute({ svg: SVG, width: -5 }), /positive whole number/)
  await assert.rejects(render.execute({ svg: SVG, width: 2000 }), /over the 100000-pixel limit/)
  await assert.rejects(render.execute({ svg: '<svg><image href="/etc/hosts"/></svg>' }), /links to/)
})

test('chart_render: draws inline data at a readable default size, from an object or a JSON string', async () => {
  const chart = tool({ outputDir: tempDir() }, 'chart_render')
  const out = await chart.execute({ spec: BARS, format: 'jpeg' })
  assert.match(out, /^Saved JPEG \d+×\d+ .*chart-\d{8}T\d{6}Z\.jpg$/)
  const meta = await sharp(savedPath(out)).metadata()
  assert.ok(meta.width > 480 && meta.height > 300, `${meta.width}×${meta.height}`)
  const sized = await chart.execute({ spec: JSON.stringify({ ...BARS, width: 100, height: 50 }) })
  const small = await sharp(savedPath(sized)).metadata()
  assert.ok(small.width < 200 && small.height < 150, `${small.width}×${small.height}`)
})

test('chart_render: refuses external data anywhere in the spec, and reports broken specs', async () => {
  const chart = tool({ outputDir: tempDir() }, 'chart_render')
  await assert.rejects(chart.execute({ spec: { data: { url: 'file:///etc/passwd' }, mark: 'bar' } }), /spec\.data\.url/)
  await assert.rejects(chart.execute({ spec: { layer: [{ data: { url: 'https://x.example/d.csv' }, mark: 'line' }] } }), /spec\.layer\[0\]\.data\.url/)
  await assert.rejects(chart.execute({ spec: [] }), /Vega-Lite JSON object/)
  const badExpr = { ...BARS, transform: [{ calculate: 'datum.n *', as: 'm' }] }
  await assert.rejects(chart.execute({ spec: badExpr }))
})

test('media: file names are cleaned and files are never overwritten', async () => {
  assert.equal(safeBaseName('../../etc/passwd', 'image'), 'etc-passwd')
  assert.equal(safeBaseName('生日 贺卡!', 'image'), '生日-贺卡')
  assert.equal(safeBaseName('***', 'image'), 'image')
  const dir = tempDir()
  const now = new Date('2026-11-03T08:00:00Z')
  const first = await saveFile(dir, 'card', 'png', Buffer.from('a'), now)
  const second = await saveFile(dir, 'card', 'png', Buffer.from('b'), now)
  assert.match(first, /card-20261103T080000Z\.png$/)
  assert.match(second, /card-20261103T080000Z-2\.png$/)
  assert.equal(readFileSync(first, 'utf8'), 'a')
})
