// Media pack, html_render: the HTML allowlist, font choice, still and animated images, pictures from
// the output folder, limits, and real Chinese text when the host has a CJK font (CI installs one on Linux).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { checkHtml, chooseFonts, createHtmlRenderer, htmlTool, resolveSettings } from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

const tempDir = () => mkdtempSync(join(tmpdir(), 'pack-media-html-'))
const LIMITS = { maxHtmlBytes: 10_000, maxImageBytes: 1_000_000 }
const savedPath = (message) => /: (\/.+|[A-Z]:\\.+?)(\n|$)/.exec(message)[1]
const PAGE = (body, css = '') => `<style>.root{width:100%;height:100%;display:flex;background:#ffffff}${css}</style><div class="root">${body}</div>`
const hasCjkFont = spawnSync('fc-match', ['-f', '%{lang}', 'sans-serif:lang=zh-cn']).stdout?.toString().includes('zh')

/** RGB of one pixel. */
async function pixel(path, x, y) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * 3
  return [data[i], data[i + 1], data[i + 2]]
}

function htmlRender(config) {
  return htmlTool(resolveSettings(config))
}

test('html: the allowlist keeps scripts, web fonts and links out, and lists picture files', () => {
  assert.deepEqual(checkHtml(PAGE('<img src="cat.png"/><div style="background-image:url(\'bg.jpg\')"></div><a href="#top"></a>'), LIMITS), ['cat.png', 'bg.jpg'])
  assert.deepEqual(checkHtml('<img src="data:image/png;base64,iVBORw0KGgo="/><img src="/srv/uploads/a.webp"/>', LIMITS), ['/srv/uploads/a.webp'])
  const refused = [
    ['<script>alert(1)</script>', /scripts/],
    ['<link rel="stylesheet" href="a.css">', /<link>/],
    ['<iframe src="https://evil.example"></iframe>', /embedded pages/],
    ['<style>@import "x.css";</style>', /@import/],
    ['<style>@font-face{font-family:a;src:url(a.woff2)}</style>', /web fonts/],
    ['<img src="https://evil.example/a.png">', /links to "https:\/\/evil/],
    ['<img src="file:///etc/hosts.png">', /links to "file:/],
    ['<div style="background:url(notes.txt)"></div>', /links to "notes\.txt"/],
    ['  ', /empty/],
  ]
  for (const [html, reason] of refused) assert.throws(() => checkHtml(html, LIMITS), reason, html)
  assert.throws(() => checkHtml('x'.repeat(20), { ...LIMITS, maxHtmlBytes: 10 }), /larger than 10 bytes/)
})

test('html: configured fonts come first, host fonts once each, generics on the first of a kind', async () => {
  const host = { 'sans-serif:lang=zh-cn': '/f/cjk.ttc', 'sans-serif:lang=zh-cn:weight=bold': '/f/cjk-bold.ttc', 'serif:lang=zh-cn': '/f/cjk.ttc', monospace: '/f/mono.ttf' }
  const fonts = await chooseFonts(['/mine/brand.ttf'], async (pattern) => host[pattern])
  assert.deepEqual(fonts, [
    { path: '/mine/brand.ttf' },
    { path: '/f/cjk.ttc', generic: 'sans-serif' },
    { path: '/f/cjk-bold.ttc', generic: undefined },
    { path: '/f/mono.ttf', generic: 'monospace' },
  ])
})

test('html_render: a still is drawn after its animations settle, at the asked size and density', async () => {
  const out = tempDir()
  const render = htmlRender({ outputDir: out })
  const html = PAGE('<div class="box"></div>', '@keyframes in{from{opacity:0}to{opacity:1}}.box{width:100px;height:100px;background:#ff0000;animation:in 1s both}')
  const message = await render.execute({ html, width: 200, height: 120, scale: 2, name: 'card' })
  assert.match(message, /^Saved PNG 400×240 \(\d+ KB\): .*card-\d{8}T\d{6}Z\.png/)
  const path = savedPath(message)
  assert.deepEqual([(await sharp(path).metadata()).width, (await sharp(path).metadata()).height], [400, 240])
  assert.deepEqual(await pixel(path, 50, 50), [255, 0, 0])
  assert.deepEqual(await pixel(path, 300, 50), [255, 255, 255])
})

test('html_render: without a height the page is as tall as its content; jpeg and webp work', async () => {
  const render = htmlRender({ outputDir: tempDir() })
  const tall = '<div style="display:flex;flex-direction:column;width:100%"><div style="height:300px;background:#00f"></div><div style="height:150px;background:#0f0"></div></div>'
  assert.match(await render.execute({ html: tall, width: 100, format: 'jpeg' }), /^Saved JPEG 100×450 .*\.jpg$/)
  assert.match(await render.execute({ html: tall, width: 100, format: 'webp' }), /^Saved WEBP 100×450 .*\.webp$/)
})

test('html_render: seconds makes an animated GIF of the CSS animation', async () => {
  const render = htmlRender({ outputDir: tempDir() })
  const html = PAGE('<div class="dot"></div>', '@keyframes go{from{transform:translateX(0)}to{transform:translateX(100px)}}.dot{width:20px;height:20px;background:#f00;animation:go 1s linear both}')
  const message = await render.execute({ html, width: 140, height: 20, seconds: 1 })
  assert.match(message, /^Saved animated GIF \(1 s\) 140×20/)
  const meta = await sharp(savedPath(message), { animated: true }).metadata()
  assert.equal(meta.pages, 20)
  assert.equal(meta.delay[0], 50)
})

test('html_render: shows a picture from the output folder, refuses one from elsewhere', async () => {
  const out = tempDir()
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00ff00' } }).png().toFile(join(out, 'green.png'))
  const render = htmlRender({ outputDir: out })
  const message = await render.execute({ html: PAGE('<img src="green.png" style="width:50px;height:50px"/>'), width: 100, height: 50 })
  assert.deepEqual(await pixel(savedPath(message), 25, 25), [0, 255, 0])
  const elsewhere = tempDir()
  writeFileSync(join(elsewhere, 'secret.png'), 'x')
  await assert.rejects(render.execute({ html: PAGE(`<img src="${join(elsewhere, 'secret.png')}"/>`) }), /not inside the output folder/)
  await assert.rejects(render.execute({ html: PAGE('<img src="missing.png"/>') }), /No file at "missing\.png"/)
})

test('html_render: checks sizes, formats and the pixel budget', async () => {
  const render = htmlRender({ outputDir: tempDir(), maxPixels: 10_000 })
  const html = PAGE('')
  await assert.rejects(render.execute({ html, width: 200, height: 100 }), /over the 10000-pixel limit/)
  await assert.rejects(render.execute({ html, width: 5 }), /width must be a whole number from 16 to 4096/)
  await assert.rejects(render.execute({ html, width: 50, scale: 4 }), /scale must be a whole number from 1 to 3/)
  await assert.rejects(render.execute({ html, width: 50, format: 'gif' }), /format must be one of png, jpeg, webp\./)
  await assert.rejects(render.execute({ html, width: 50, seconds: 1, format: 'png' }), /one of gif, webp when seconds is set/)
  await assert.rejects(render.execute({ html, width: 50, seconds: 30 }), /seconds must be from 0\.5 to 10/)
})

test('html_render: Chinese text uses a real font when the host has one', { skip: !hasCjkFont && 'no CJK font here' }, async () => {
  const renderer = createHtmlRenderer(resolveSettings({}).html)
  const draw = async (text) => {
    const page = await renderer.open(`<div style="display:flex;width:100%;height:100%;background:#fff;font-size:48px">${text}</div>`)
    return (await renderer.still(page, { width: 64, height: 64, scale: 1 }, 'raw')).data
  }
  assert.ok(await renderer.hasFonts())
  // Without a CJK font both characters are the same missing-glyph box.
  assert.notDeepEqual(await draw('中'), await draw('国'))
})
