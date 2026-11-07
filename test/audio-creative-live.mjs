// Explicit online acceptance: sends only this public test phrase to Microsoft.
// Run: node test/audio-creative-live.mjs <evidence-directory>
import assert from 'node:assert/strict'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createTools } from '../packages/dsh-tool-ultra-pack-audio-creative/lib/index.js'

const dir = resolve(process.argv[2] || 'audio-evidence')
await mkdir(dir, { recursive: true })
const output = join(dir, 'speech.wav')
const text = 'Hello. This is a public speech synthesis acceptance test for Tool Ultra.'
const result = await createTools().find(t => t.name === 'audio_synthesize').execute({
  text, voice: 'en-US-JennyNeural', output,
})
const { stdout } = await promisify(execFile)('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', output,
], { timeout: 15000 })
const probe = JSON.parse(stdout)
const duration = Number(probe.format.duration)
assert.ok(duration > 2 && duration < 20, `unexpected duration ${duration}`)
assert.equal(probe.streams[0].sample_rate, '24000')
assert.equal(probe.streams[0].channels, 1)
assert.equal(probe.streams[0].codec_name, 'pcm_s16le')
assert.ok((await stat(output)).size > 10000)
await writeFile(join(dir, 'metrics.json'), JSON.stringify({ text, result, probe, bytes: (await stat(output)).size }, null, 2))
console.log(JSON.stringify({ output, duration, sampleRate: probe.streams[0].sample_rate, codec: probe.streams[0].codec_name }))
