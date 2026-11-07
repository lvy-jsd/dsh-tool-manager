// Audio creative pack unit tests: tool declarations, apply registration, and tool parameter spec verification.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createTools,
  apply,
  TOOL_NAMES,
} from '../../packages/dsh-tool-ultra-pack-audio-creative/lib/index.js'

test('audio-creative: every tool is declared in package.json toolCatalog', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../packages/dsh-tool-ultra-pack-audio-creative/package.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(pkg.dsh.toolCatalog.tools).sort(), [...TOOL_NAMES].sort())
  assert.deepEqual(createTools().map((t) => t.name).sort(), [...TOOL_NAMES].sort())
})

test('audio-creative: apply registers tools minus disabled ones', () => {
  const registered = []
  apply({ tools: { register: (d) => registered.push(d.name ?? d.schema?.name) } }, { disable: ['audio_mix'] })
  assert.equal(registered.length, TOOL_NAMES.length - 1)
  assert.ok(!registered.includes('audio_mix'))
})

test('audio-creative: tool parameters enforce non-empty requirements', async () => {
  const tools = createTools()
  const synthTool = tools.find((t) => t.name === 'audio_synthesize')
  const cutTool = tools.find((t) => t.name === 'audio_cut')
  const mixTool = tools.find((t) => t.name === 'audio_mix')

  await assert.rejects(
    synthTool.execute({ text: '' }),
    /Text to synthesize cannot be empty/,
  )

  await assert.rejects(
    cutTool.execute({ input: '', start: '0' }),
    /Input audio path cannot be empty/,
  )

  await assert.rejects(
    mixTool.execute({ voice: 'nonexistent-voice.mp3', bgm: 'nonexistent-bgm.mp3' }),
    /Voice track not found/,
  )
})
