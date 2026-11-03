// Media pack, video_understand: ffprobe parsing, frame sampling, the storyboard image,
// the tool with stand-ins, and a real run on a generated clip when ffmpeg is installed (CI installs it on Linux).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { buildStoryboard, cutArgs, extractArgs, parseCuts, parseProbe, planFrames, probeArgs, resolveSettings, shortTime, understandTool } from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

const tempDir = () => mkdtempSync(join(tmpdir(), 'pack-media-understand-'))
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const PROBE = JSON.stringify({
  streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001' }, { codec_type: 'audio' }],
  format: { duration: '192.5' },
})
const frame = (color) => sharp({ create: { width: 320, height: 180, channels: 3, background: color } }).jpeg().toBuffer()

test('understand: ffprobe output becomes length, picture and sound facts', () => {
  assert.deepEqual(parseProbe(PROBE), { duration: 192.5, video: { width: 1920, height: 1080, fps: 29.97 }, hasAudio: true })
  assert.deepEqual(parseProbe(JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '3' } })), { duration: 3, video: undefined, hasAudio: true })
  assert.throws(() => parseProbe(JSON.stringify({ streams: [], format: {} })), /Could not read the length/)
  assert.deepEqual(probeArgs('/v.mp4').slice(-3), ['-of', 'json', '/v.mp4'])
})

test('understand: cuts are read from ffmpeg and frames follow the shots', () => {
  assert.match(cutArgs('/in/v.mp4').join(' '), /-i \/in\/v\.mp4 -an -vf scale=160:-2,select='gt\(scene,0\.1\)',metadata=print:file=- -f null -$/)
  const printed = 'frame:0    pts:61440   pts_time:4\nlavfi.scene_score=0.145947\nframe:1    pts:184320  pts_time:12\nlavfi.scene_score=0.637569\n'
  assert.deepEqual(parseCuts(printed), [{ time: 4, score: 0.145947 }, { time: 12, score: 0.637569 }])
  assert.deepEqual(planFrames(12, [], 4), { times: [1.5, 4.5, 7.5, 10.5], cuts: [] })
  assert.deepEqual(planFrames(16, parseCuts(printed), 4), { times: [2, 6, 10, 14], cuts: [4, 12] })
  const many = [{ time: 2, score: 0.2 }, { time: 4, score: 0.9 }, { time: 6, score: 0.5 }, { time: 8, score: 0.4 }]
  assert.deepEqual(planFrames(10, many, 3).cuts, [4, 6], 'only the strongest cuts when shots outnumber frames')
  assert.deepEqual([shortTime(2.25, 10), shortTime(75, 192)], ['2.3 s', '01:15'])
})

test('understand: ffmpeg takes the first frame at or after each planned time', () => {
  const args = extractArgs('/in/v.mp4', '/t', [1.5, 4.25])
  assert.equal(args[args.indexOf('-vf') + 1], "select='gte(t,1.500)*(isnan(prev_t)+lt(prev_t,1.500))+gte(t,4.250)*(isnan(prev_t)+lt(prev_t,4.250))',scale=320:180:force_original_aspect_ratio=decrease")
  assert.deepEqual(args.slice(-5), ['-fps_mode', 'vfr', '-frames:v', '2', join('/t', 'frame-%02d.jpg')])
})

test('understand: the storyboard is a grid four frames wide', async () => {
  const dir = tempDir()
  const paths = []
  for (const [i, color] of ['#f00', '#0f0', '#00f', '#ff0', '#0ff'].entries()) {
    paths.push(join(dir, `frame-${i}.jpg`))
    writeFileSync(paths[i], await frame(color))
  }
  const meta = await sharp(await buildStoryboard(paths, ['0.0 s', '1.0 s', '2.0 s', '3.0 s', '4.0 s'])).metadata()
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 1280, 360])
})

/** Stand-in for ffprobe and ffmpeg: answers the probe, writes frames, writes silent audio. */
function fakeMedia(probe, calls = []) {
  return async (file, args) => {
    calls.push(file)
    if (file === 'ffprobe') return probe
    const out = args.at(-1)
    if (out === '-') return 'frame:0 pts:1 pts_time:100\nlavfi.scene_score=0.5\n'
    if (out.endsWith('frame-%02d.jpg')) {
      const count = Number(args[args.indexOf('-frames:v') + 1])
      for (let i = 1; i <= count; i++) writeFileSync(out.replace('%02d', String(i).padStart(2, '0')), await frame('#336'))
    } else {
      writeFileSync(out, Buffer.from(new Float32Array(16_000).buffer))
    }
    return ''
  }
}

test('video_understand: reports facts, saves a storyboard and adds the transcript', async () => {
  const out = tempDir()
  writeFileSync(join(out, 'clip.mp4'), 'x')
  const calls = []
  const transcriber = async () => [{ start: 1, end: 3, text: '大家好' }]
  const tool = understandTool(resolveSettings({ outputDir: out }), { run: fakeMedia(PROBE, calls), transcriber })
  const result = await tool.execute({ file: 'clip.mp4', frames: 8, name: 'trip' })
  assert.match(result, /^File .*clip\.mp4: 03:12 long, 1920×1080, 29\.97 fps, with sound\./)
  assert.match(result, /\n2 shots; the scene changes at 01:40\.\nStoryboard/)
  const [, board] = /Storyboard \(8 frames, at least one per shot, .*\): (.+\.jpg)\n/.exec(result)
  assert.match(board, /trip-\d{8}T\d{6}Z\.jpg$/)
  const meta = await sharp(board).metadata()
  assert.deepEqual([meta.width, meta.height], [1280, 360])
  assert.match(result, /Speech \(SenseVoice Small \(FunAudioLLM\), one speaker, 1 segments\):\n\[00:01-00:03\] 大家好$/)
  assert.deepEqual(calls, ['ffprobe', 'ffmpeg', 'ffmpeg', 'ffmpeg'])
})

test('video_understand: audio-only files, skipped transcripts and bad frame counts', async () => {
  const out = tempDir()
  writeFileSync(join(out, 'memo.m4a'), 'x')
  const audioOnly = JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '5' } })
  const tool = understandTool(resolveSettings({ outputDir: out }), { run: fakeMedia(audioOnly), transcriber: async () => [] })
  assert.equal((await tool.execute({ file: 'memo.m4a' })).split('\n\n')[1], 'Speech: none found.')
  assert.doesNotMatch(await tool.execute({ file: 'memo.m4a', transcript: false }), /Speech|Storyboard/)
  await assert.rejects(tool.execute({ file: 'memo.m4a', frames: 40 }), /frames must be a whole number from 4 to 16/)
})

test('video_understand: real ffmpeg reads a generated clip', { skip: !hasFfmpeg && 'ffmpeg is not installed here' }, async () => {
  const out = tempDir()
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=6', '-f', 'lavfi', '-i', 'sine=duration=6',
    '-shortest', '-pix_fmt', 'yuv420p', join(out, 'clip.mp4')])
  const tool = understandTool(resolveSettings({ outputDir: out }), { transcriber: async (samples) => [{ start: 0, end: 6, text: `${samples.length} samples` }] })
  const result = await tool.execute({ file: 'clip.mp4' })
  assert.match(result, /00:06 long, 640×360, 25 fps, with sound/)
  const board = /Storyboard \((\d+) frames.*: (.+\.jpg)\n/.exec(result)
  assert.ok(Number(board[1]) >= 11, board[1])
  const meta = await sharp(board[2]).metadata()
  assert.deepEqual([meta.width, meta.height], [1280, 540])
  assert.match(result, /\[00:00-00:06\] 9\d{4} samples/)
})
