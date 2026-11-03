// Media pack, speech: which files may be read, ffmpeg decoding arguments, transcript formats,
// the audio_transcribe tool with stand-ins, and a real Whisper run when MEDIA_SPEECH_E2E=1 (CI on Linux).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clock, decodeArgs, resolveInputFile, resolveSettings, timestampedText, toSrt, transcribeTool } from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

const tempDir = () => mkdtempSync(join(tmpdir(), 'pack-media-speech-'))
const SEGMENTS = [{ start: 0, end: 2.5, text: '你好，欢迎收听。' }, { start: 2.5, end: 65.25, text: 'Today we talk about cats.' }]

/** Stand-in ffmpeg: writes `seconds` of 16 kHz float silence to the output path. */
const fakeDecoder = (seconds, calls = []) => async (file, args) => {
  calls.push({ file, args })
  writeFileSync(args.at(-1), Buffer.from(new Float32Array(seconds * 16_000).buffer))
}

test('speech: only files in the output folder or allowed input folders can be read', async () => {
  const out = tempDir()
  const uploads = tempDir()
  const elsewhere = tempDir()
  writeFileSync(join(out, 'a.wav'), 'x')
  writeFileSync(join(uploads, 'b.mp4'), 'x')
  writeFileSync(join(elsewhere, 'c.wav'), 'x')
  const folders = { outputDir: out, inputDirs: [uploads] }
  assert.match(await resolveInputFile(folders, 'a.wav'), /a\.wav$/)
  assert.match(await resolveInputFile(folders, join(uploads, 'b.mp4')), /b\.mp4$/)
  await assert.rejects(resolveInputFile(folders, join(elsewhere, 'c.wav')), /not inside the output folder or an allowed input folder/)
  await assert.rejects(resolveInputFile(folders, join(uploads, '..', 'x', 'c.wav')), /No file at/)
  await assert.rejects(resolveInputFile(folders, 'sub/a.wav'), /must be a file name from the output folder or an absolute path/)
  await assert.rejects(resolveInputFile(folders, uploads), /not inside/)
  mkdirSync(join(uploads, 'nested'))
  const linked = (() => { try { symlinkSync(join(elsewhere, 'c.wav'), join(uploads, 'nested', 'link.wav')); return true } catch { return false } })()
  if (linked) await assert.rejects(resolveInputFile(folders, join(uploads, 'nested', 'link.wav')), /not inside/)
})

test('speech: ffmpeg decodes to 16 kHz mono float, capped in length, without video', () => {
  assert.deepEqual(decodeArgs('/in/talk.mp4', '/t/audio.f32', 1800), [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', '/in/talk.mp4', '-t', '1800', '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '/t/audio.f32',
  ])
})

test('speech: clock, SRT and timestamped text', () => {
  assert.deepEqual([clock(0), clock(75.5), clock(3725)], ['00:00', '01:15', '1:02:05'])
  assert.equal(toSrt(SEGMENTS), '1\n00:00:00,000 --> 00:00:02,500\n你好，欢迎收听。\n\n2\n00:00:02,500 --> 00:01:05,250\nToday we talk about cats.\n')
  assert.equal(timestampedText(SEGMENTS, 1000), '[00:00-00:02] 你好，欢迎收听。\n[00:02-01:05] Today we talk about cats.')
  assert.match(timestampedText(SEGMENTS, 10), /^\[00:00-00:\n\[truncated: \d+ more characters are in the SRT file\]$/)
})

test('audio_transcribe: decodes the file, transcribes it and saves SRT subtitles', async () => {
  const out = tempDir()
  writeFileSync(join(out, 'talk.m4a'), 'x')
  const calls = []
  let heard
  const transcriber = async (samples, options) => { heard = { length: samples.length, options }; return SEGMENTS }
  const settings = resolveSettings({ outputDir: out, ffmpegPath: '/opt/ffmpeg', maxTranscribeSeconds: 600 })
  const tool = transcribeTool(settings, { run: fakeDecoder(3, calls), transcriber })
  const result = await tool.execute({ file: 'talk.m4a', language: 'zh', name: 'podcast' })
  assert.equal(calls[0].file, '/opt/ffmpeg')
  assert.ok(calls[0].args.includes('600'))
  assert.deepEqual(heard, { length: 48_000, options: { language: 'zh' } })
  assert.match(result, /^Transcript of .*talk\.m4a \(00:03, 2 segments, local model onnx-community\/whisper-small\)\. Subtitles saved: (.+podcast-\d{8}T\d{6}Z\.srt)\n\n\[00:00-00:02\] 你好/)
  const srtPath = /Subtitles saved: (.+\.srt)/.exec(result)[1]
  assert.match(readFileSync(srtPath, 'utf8'), /^1\n00:00:00,000 --> 00:00:02,500\n你好/)
})

test('audio_transcribe: silence, bad languages and outside files are handled plainly', async () => {
  const out = tempDir()
  writeFileSync(join(out, 'quiet.wav'), 'x')
  const tool = transcribeTool(resolveSettings({ outputDir: out }), { run: fakeDecoder(2), transcriber: async () => [] })
  assert.match(await tool.execute({ file: 'quiet.wav' }), /^No speech found in .*quiet\.wav \(00:02 of audio\)\.$/)
  await assert.rejects(tool.execute({ file: 'quiet.wav', language: 'chinese!' }), /language must be a short code/)
  const outside = join(tempDir(), 'elsewhere.wav')
  writeFileSync(outside, 'x')
  await assert.rejects(tool.execute({ file: outside }), /not inside the output folder/)
})

const SAMPLE = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav'

test('audio_transcribe: a real local Whisper model transcribes speech', { skip: process.env.MEDIA_SPEECH_E2E !== '1' && 'set MEDIA_SPEECH_E2E=1 (needs ffmpeg and network for the model)', timeout: 600_000 }, async () => {
  const out = tempDir()
  writeFileSync(join(out, 'jfk.wav'), Buffer.from(await (await fetch(SAMPLE)).arrayBuffer()))
  const settings = resolveSettings({ outputDir: out, speechModel: 'onnx-community/whisper-tiny', modelCacheDir: join(tempDir(), 'models') })
  const result = await transcribeTool(settings).execute({ file: 'jfk.wav', language: 'en' })
  assert.match(result, /ask not what your country can do for you/i)
})
