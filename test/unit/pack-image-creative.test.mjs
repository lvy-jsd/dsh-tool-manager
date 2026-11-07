// Image creative pack unit tests: image metadata inspection and edit operations via sharp.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  createTools,
  apply,
  TOOL_NAMES,
} from '../../packages/dsh-tool-ultra-pack-image-creative/lib/index.js'

test('image-creative: every tool is declared in package.json toolCatalog', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../packages/dsh-tool-ultra-pack-image-creative/package.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(pkg.dsh.toolCatalog.tools).sort(), [...TOOL_NAMES].sort())
  assert.deepEqual(createTools().map((t) => t.name).sort(), [...TOOL_NAMES].sort())
})

test('image-creative: apply registers tools minus disabled ones', () => {
  const registered = []
  apply({ tools: { register: (d) => registered.push(d.name ?? d.schema?.name) } }, { disable: ['image_generate'] })
  assert.equal(registered.length, TOOL_NAMES.length - 1)
  assert.ok(!registered.includes('image_generate'))
})

test('image-creative: metadata and image_edit transformations via sharp', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'img-test-'))
  try {
    const srcPng = join(temp, 'input.png')
    const outJpeg = join(temp, 'output.jpg')

    // Create a 200x100 solid red PNG buffer using sharp
    await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    }).png().toFile(srcPng)

    const tools = createTools({ artifactsDir: temp })
    const metaTool = tools.find((t) => t.name === 'image_metadata')
    const editTool = tools.find((t) => t.name === 'image_edit')

    // 1. Check metadata
    const metaText = await metaTool.execute({ path: srcPng })
    assert.match(metaText, /200 x 100 px/)
    assert.match(metaText, /png/)

    // 2. Perform edit: resize to 100x50, convert to jpeg, rotate 90
    const editRes = await editTool.execute({
      input: srcPng,
      output: outJpeg,
      width: 100,
      height: 50,
      format: 'jpeg',
      quality: 90,
      rotate: 90,
    })

    assert.match(editRes, /Image edited successfully/)
    assert.match(editRes, /output\.jpg/)

    // Verify output file geometry
    const outMeta = await sharp(outJpeg).metadata()
    assert.equal(outMeta.format, 'jpeg')
    // In sharp, resize takes effect, then rotate 90 swaps width and height: 50 -> 100 x 50
    assert.equal(outMeta.width, 100)
    assert.equal(outMeta.height, 50)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
