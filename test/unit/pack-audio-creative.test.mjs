// Audio creative pack unit tests: tool declarations, apply registration, and tool parameter spec verification.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  createTools,
  apply,
  TOOL_NAMES,
} from '../../packages/dsh-tool-ultra-pack-audio-creative/lib/index.js'

test('audio-creative: real ffmpeg cuts and mixes WAV without overwriting', {
  skip: spawnSync('ffmpeg', ['-version']).status !== 0 || spawnSync('ffprobe', ['-version']).status !== 0,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'audio-creative-'))
  try {
    const input = join(temp, 'voice.wav')
    const bgm = join(temp, 'bgm.wav')
    for (const [file, frequency] of [[input, 440], [bgm, 220]]) {
      execFileSync('ffmpeg', ['-nostdin', '-n', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=3`, file], { stdio: 'ignore' })
    }
    const tools = createTools({ artifactsDir: temp })
    const cut = tools.find(t => t.name === 'audio_cut')
    const mix = tools.find(t => t.name === 'audio_mix')
    const output = join(temp, 'cut.wav')
    await cut.execute({ input, start: '1', to: '2', output })
    const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate', '-of', 'json', file], { encoding: 'utf8' }))
    assert.ok(Math.abs(Number(probe(output).format.duration) - 1) < 0.05)
    await assert.rejects(cut.execute({ input, start: '0', duration: '1', output }), /refusing to overwrite/)
    await assert.rejects(cut.execute({ input, start: '2', to: '1', output: join(temp, 'invalid.wav') }), /Duration must be positive/)
    const mixed = join(temp, 'mix.wav')
    await mix.execute({ voice: input, bgm, output: mixed })
    assert.ok(Math.abs(Number(probe(mixed).format.duration) - 3) < 0.05)
    assert.equal(probe(mixed).streams[0].codec_name, 'pcm_s16le')
    await assert.rejects(mix.execute({ voice: input, bgm, output: join(temp, 'invalid.wav'), bgm_volume: NaN }), /Volumes must be/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

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
