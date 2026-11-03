// Media pack, speech: which files may be read, ffmpeg decoding arguments, transcript formats,
// model downloads and archives, cutting audio into pieces, the audio_transcribe tool with stand-ins,
// and a real SenseVoice + diarization run when MEDIA_SPEECH_E2E=1 (CI on Linux).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clock, createSpeechEngine, decodeArgs, ensureModel, extrasOf, MODELS, modelFor, numberSpeakers, resolveInputFile, resolveSettings,
  tidyPieces, timestampedText, toSrt, transcribeTool, untar,
} from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

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

test('speech: speakers, emotions and sounds show in the transcript and the subtitles', () => {
  const heard = [
    { start: 0, end: 2, text: '你好！', speaker: 1, emotion: 'happy' },
    { start: 2, end: 4, text: '', speaker: 2, sound: 'laughter' },
    { start: 4, end: 6, text: 'Thanks.', speaker: 2 },
  ]
  assert.equal(timestampedText(heard, 1000), '[00:00-00:02] Speaker 1 (happy): 你好！\n[00:02-00:04] Speaker 2 (laughter)\n[00:04-00:06] Speaker 2: Thanks.')
  assert.match(toSrt(heard), /00:00:00,000 --> 00:00:02,000\nSpeaker 1: 你好！\n[\s\S]*\nSpeaker 2: \[laughter\]\n/)
})

test('speech: SenseVoice tags become plain words, and neutral ones are dropped', () => {
  assert.deepEqual(extrasOf({ text: 'x', emotion: '<|HAPPY|>', event: '<|Laughter|>' }), { emotion: 'happy', sound: 'laughter' })
  assert.deepEqual(extrasOf({ text: 'x', emotion: '<|NEUTRAL|>', event: '<|Speech|>' }), {})
  assert.deepEqual(extrasOf({ text: 'x' }), {})
})

test('speech: SenseVoice reads its five languages, Whisper the rest', () => {
  assert.equal(modelFor('sensevoice', undefined), 'sensevoice')
  assert.equal(modelFor('sensevoice', 'yue'), 'sensevoice')
  assert.equal(modelFor('sensevoice', 'fr'), 'whisper-turbo')
  assert.equal(modelFor('whisper-turbo', 'zh'), 'whisper-turbo')
  assert.throws(() => resolveSettings({ speechModel: 'whisper-small' }), /speechModel must be one of sensevoice, whisper-turbo/)
})

test('speech: speaker turns are joined, long pieces cut, and speakers numbered by first word', () => {
  const pieces = tidyPieces([
    { start: 0, end: 4, speaker: 3 }, { start: 4.3, end: 8, speaker: 3 }, { start: 8.1, end: 9, speaker: 0 }, { start: 9, end: 69, speaker: 3 },
  ])
  assert.deepEqual(pieces.map((p) => [p.start, p.end, p.speaker]), [[0, 8, 3], [8.1, 9, 0], [9, 29, 3], [29, 49, 3], [49, 69, 3]])
  assert.deepEqual(numberSpeakers(pieces).map((p) => p.speaker), [1, 2, 1, 1, 1])
  assert.deepEqual(numberSpeakers([{ speaker: 5 }, { speaker: 5 }]), [{ speaker: undefined }, { speaker: undefined }])
})

/** A ustar archive in memory, the way the model releases pack their files. */
function tarOf(files) {
  const blocks = []
  for (const [name, content] of Object.entries(files)) {
    const header = Buffer.alloc(512)
    header.write(name, 0)
    header.write(content.length.toString(8).padStart(11, '0'), 124)
    header.write('0', 156)
    blocks.push(header, Buffer.from(content), Buffer.alloc((512 - (content.length % 512)) % 512))
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)])
}

test('speech: only the wanted files come out of a model archive', () => {
  const files = untar(tarOf({ 'model/README.md': 'hi', 'model/tokens.txt': 'a b c', 'model/test_wavs/zh.wav': 'RIFF' }), new Set(['tokens.txt']))
  assert.deepEqual([...files.keys()], ['tokens.txt'])
  assert.equal(files.get('tokens.txt').toString(), 'a b c')
})

test('speech: a model downloads once from the mirror, checked against its SHA-256', async () => {
  const store = { cacheDir: tempDir(), mirror: 'https://mirror.example/sherpa/' }
  const vad = Buffer.from('silero')
  const expected = createHash('sha256').update(vad).digest('hex')
  const asked = []
  const fetchBytes = async (url) => { asked.push(url); return vad }
  await assert.rejects(ensureModel('vad', store, fetchBytes), /not the expected one.*Set modelMirror/)
  const original = MODELS.vad.sha256
  try {
    MODELS.vad.sha256 = expected
    const paths = await ensureModel('vad', store, fetchBytes)
    await ensureModel('vad', store, fetchBytes)
    assert.deepEqual(asked, ['https://mirror.example/sherpa/asr-models/silero_vad.onnx', 'https://mirror.example/sherpa/asr-models/silero_vad.onnx'])
    assert.equal(readFileSync(paths['silero_vad.onnx'], 'utf8'), 'silero')
    assert.ok(!existsSync(`${paths['silero_vad.onnx']}.part`))
  } finally {
    MODELS.vad.sha256 = original
  }
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
  assert.deepEqual(heard, { length: 48_000, options: { language: 'zh', speakers: true } })
  assert.match(result, /^Transcript of .*talk\.m4a \(00:03, one speaker, 2 segments, local model SenseVoice Small \(FunAudioLLM\)\)\. Subtitles saved: (.+podcast-\d{8}T\d{6}Z\.srt)\n\n\[00:00-00:02\] 你好/)
  await tool.execute({ file: 'talk.m4a', language: 'fr', speakers: false })
  assert.deepEqual(heard.options, { language: 'fr', speakers: false })
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

const SAMPLE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/0-four-speakers-zh.wav'

test('audio_transcribe: real local models tell four Chinese speakers apart', { skip: process.env.MEDIA_SPEECH_E2E !== '1' && 'set MEDIA_SPEECH_E2E=1 (needs ffmpeg and network for the models)', timeout: 900_000 }, async () => {
  const out = tempDir()
  writeFileSync(join(out, 'meeting.wav'), Buffer.from(await (await fetch(SAMPLE)).arrayBuffer()))
  const settings = resolveSettings({ outputDir: out, modelCacheDir: join(tempDir(), 'models') })
  const tool = transcribeTool(settings, { transcriber: createSpeechEngine(settings.speech) })
  const result = await tool.execute({ file: 'meeting.wav' })
  assert.match(result, /\(00:56, [3-5] speakers, /)
  assert.match(result, /Speaker 1: 这是一个测试说话人日志的音频。/)
  assert.match(result, /雷军/)
})
