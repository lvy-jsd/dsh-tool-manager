// Media pack, video: request checks, the timeline, transitions and other pixel work, captions,
// the encoder arguments, the tool with a stand-in ffmpeg, and a real render when ffmpeg is installed
// (CI installs it on Linux).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  captionPage, checkAudioName, checkCaptions, dim, ease, encodeArgs, fadeLevel, frameAt, onBlack, overlay, parseSrt,
  parseVideoRequest, photoPage, planTimeline, resolveOutputFile, resolveSettings, transition, videoTool,
} from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

const LIMITS = { maxSeconds: 180, maxScenes: 60, maxPixels: 1920 * 1080 }
const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${fill}"/></svg>`
const tempDir = () => mkdtempSync(join(tmpdir(), 'pack-media-video-'))
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
/** A raw RGBA frame of one colour. */
const solid = (width, height, [r, g, b, a = 255]) => Buffer.from(Array.from({ length: width * height }, () => [r, g, b, a]).flat())
const rgbAt = (frame, width, x, y) => [...frame.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)]

test('video: requests are checked before anything renders', () => {
  const ok = parseVideoRequest({ scenes: [{ svg: svg('red') }, { html: '<div></div>', seconds: 1.5 }, { image: 'a.jpg', motion: 'pan-left' }] }, LIMITS)
  assert.deepEqual([ok.width, ok.height, ok.fps, ok.fade, ok.captionStyle, ok.timeline.total], [1280, 720, 30, true, 'subtitle', 7.5])
  assert.deepEqual(ok.scenes.map((s) => s.transition), ['fade', 'fade', 'fade'])
  assert.deepEqual(ok.scenes[2], { image: 'a.jpg', motion: 'pan-left', seconds: 3, transition: 'fade' })
  assert.equal(parseVideoRequest({ scenes: [{ svg: svg('red') }], fade: false }, LIMITS).scenes[0].transition, 'cut')
  const refused = [
    [{ scenes: [] }, /Give 1 to 60 scenes/],
    [{ scenes: [{ seconds: 2 }] }, /Scene 1 needs exactly one of svg, html or image/],
    [{ scenes: [{ svg: svg('red'), html: '<div></div>' }] }, /exactly one/],
    [{ scenes: [{ svg: svg('red'), seconds: 0.1 }] }, /seconds must be between 0.5 and 60/],
    [{ scenes: [{ svg: svg('red'), transition: 'spin' }] }, /Scene 1: transition must be one of fade, cut/],
    [{ scenes: [{ image: 'a.jpg', motion: 'shake' }] }, /motion must be one of zoom-in/],
    [{ scenes: [{ svg: svg('red') }], width: 641 }, /width must be an even/],
    [{ scenes: [{ svg: svg('red') }], width: 3840, height: 2160 }, /pixel limit/],
    [{ scenes: [{ svg: svg('red') }], fps: 25 }, /fps must be one of 24, 30, 60/],
    [{ scenes: [{ svg: svg('red') }], subtitles: '../a.srt' }, /subtitles must be the file name/],
    [{ scenes: [{ svg: svg('red') }], captionStyle: 'huge' }, /captionStyle must be one of subtitle, pop/],
    [{ scenes: Array.from({ length: 4 }, () => ({ svg: svg('red'), seconds: 60 })) }, /240 seconds long, over the 180-second limit/],
  ]
  for (const [args, reason] of refused) assert.throws(() => parseVideoRequest(args, LIMITS), reason, JSON.stringify(args).slice(0, 80))
})

test('video: the soundtrack must be a bare audio file name', () => {
  assert.equal(checkAudioName('song-1.wav'), 'song-1.wav')
  for (const bad of ['../secret.wav', '/etc/passwd', 'sub/a.wav', '.hidden.wav', 'notes.txt', '']) {
    assert.throws(() => checkAudioName(bad), /audio must be/, bad)
  }
})

test('video: soundtrack paths cannot leave the output folder, even through a link', async () => {
  const dir = tempDir()
  const outside = join(tempDir(), 'outside.wav')
  writeFileSync(outside, 'x')
  writeFileSync(join(dir, 'inside.wav'), 'x')
  assert.match(await resolveOutputFile(dir, 'inside.wav'), /inside\.wav$/)
  // Windows runners may not allow file symlinks without admin rights.
  const linked = (() => { try { symlinkSync(outside, join(dir, 'link.wav')); return true } catch { return false } })()
  if (linked) await assert.rejects(resolveOutputFile(dir, 'link.wav'), /not inside the output folder or an allowed input folder/)
  await assert.rejects(resolveOutputFile(dir, 'missing.wav'), /No file at "missing.wav"/)
})

test('video: the timeline keeps scene lengths and centres transitions on the boundaries', () => {
  const timeline = planTimeline([{ seconds: 3, transition: 'wipe' }, { seconds: 0.8, transition: 'cut' }, { seconds: 2, transition: 'fade' }])
  assert.equal(timeline.total, 5.8)
  assert.deepEqual(timeline.starts, [0, 3, 3.8])
  assert.deepEqual(timeline.handovers.map((h) => [h.at, h.duration, h.kind]), [[3, 0.4, 'wipe'], [3.8, 0, 'cut']])
  const rounded = (frame) => JSON.parse(JSON.stringify(frame, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)))
  assert.deepEqual(rounded(frameAt(timeline, 1)), { scene: 0, local: 1 })
  assert.deepEqual(rounded(frameAt(timeline, 2.9)), { from: { scene: 0, local: 2.9 }, to: { scene: 1, local: 0.1 }, kind: 'wipe', progress: 0.25 })
  assert.deepEqual(rounded(frameAt(timeline, 3.1)), { from: { scene: 0, local: 3.1 }, to: { scene: 1, local: 0.3 }, kind: 'wipe', progress: 0.75 })
  assert.deepEqual(rounded(frameAt(timeline, 3.5)), { scene: 1, local: 0.7 })
  assert.deepEqual(rounded(frameAt(timeline, 4)), { scene: 2, local: 0.2 })
})

test('video: transitions, overlays and fades work on raw frames', () => {
  const size = { width: 4, height: 2 }
  const red = solid(4, 2, [255, 0, 0])
  const blue = solid(4, 2, [0, 0, 255])
  assert.deepEqual([ease(0), ease(0.5), ease(1)], [0, 0.5, 1])
  assert.deepEqual(rgbAt(transition(red, blue, size, 'fade', 0.5), 4, 0, 0), [127, 0, 127])
  const pushed = transition(red, blue, size, 'slide-left', 0.5)
  assert.deepEqual([rgbAt(pushed, 4, 1, 0), rgbAt(pushed, 4, 2, 0)], [[255, 0, 0], [0, 0, 255]])
  const up = transition(red, blue, size, 'slide-up', 0.5)
  assert.deepEqual([rgbAt(up, 4, 0, 0), rgbAt(up, 4, 0, 1)], [[255, 0, 0], [0, 0, 255]])
  const wiped = transition(red, blue, size, 'wipe', 0.5)
  assert.deepEqual([rgbAt(wiped, 4, 0, 0), rgbAt(wiped, 4, 3, 0)], [[0, 0, 255], [255, 0, 0]])
  assert.deepEqual(rgbAt(transition(red, blue, size, 'circle', 1), 4, 0, 0), [0, 0, 255])
  assert.equal(transition(red, blue, size, 'cut', 0.4), red)
  const caption = Buffer.concat([solid(1, 1, [255, 255, 255, 255]), solid(7, 1, [0, 0, 0, 0])])
  const covered = overlay(red, caption)
  assert.deepEqual([rgbAt(covered, 4, 0, 0), rgbAt(covered, 4, 1, 0), rgbAt(red, 4, 0, 0)], [[255, 255, 255], [255, 0, 0], [255, 0, 0]])
  assert.deepEqual(rgbAt(dim(red, 0.5), 4, 0, 0), [127, 0, 0])
  assert.deepEqual([...onBlack(solid(1, 1, [200, 100, 50, 128]))], [100, 50, 25, 255])
  assert.deepEqual([fadeLevel(0, 5, true), fadeLevel(0.2, 5, true), fadeLevel(2, 5, true), fadeLevel(5, 5, true), fadeLevel(0, 5, false)], [0, 0.5, 1, 0, 1])
})

test('video: captions come from a list or an SRT file, and their text cannot become markup', () => {
  const srt = '1\r\n00:00:01,500 --> 00:00:03,000\r\n你好\r\n\r\n2\n00:01:02.25 --> 00:01:04,000\nline one\nline two\n'
  assert.deepEqual(parseSrt(srt), [{ start: 1.5, end: 3, text: '你好' }, { start: 62.25, end: 64, text: 'line one\nline two' }])
  assert.deepEqual(checkCaptions([{ start: 1, end: 9, text: ' hi ' }, { start: 20, end: 21, text: 'late' }], 5), [{ start: 1, end: 5, text: 'hi' }])
  assert.throws(() => checkCaptions([{ start: 2, end: 1, text: 'x' }], 5), /end after start/)
  assert.throws(() => checkCaptions([{ start: 0, end: 1, text: '' }], 5), /Caption 1 needs text/)
  const page = captionPage({ start: 0, end: 1, text: '<img src="https://x/a.png">&\nok' }, 'pop', 720)
  assert.match(page, /&lt;img src="https:\/\/x\/a\.png"&gt;&amp;<br\/>ok/)
  assert.throws(() => photoPage('a").jpg', 'none', 3), /characters a file name cannot use/)
})

test('video: ffmpeg reads raw frames from standard input and maps the soundtrack', () => {
  const request = parseVideoRequest({ scenes: [{ svg: svg('red'), seconds: 2 }], width: 640, height: 360, fps: 24 }, LIMITS)
  const joined = encodeArgs(request, '/out/song.wav', '/t/video.mp4').join(' ')
  assert.match(joined, /-f rawvideo -pix_fmt rgba -s 640x360 -framerate 24 -i pipe:0 -i \/out\/song\.wav -map 0:v -map 1:a -c:a aac/)
  assert.match(joined, /-c:v libx264 .* -t 2 -movflags \+faststart \/t\/video\.mp4$/)
  assert.ok(!encodeArgs(request, undefined, '/t/v.mp4').includes('-c:a'))
})

test('video_render: draws every frame, lays captions over them and saves the MP4', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'talk.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello\n')
  const frames = []
  const feed = async (file, args, input) => {
    for await (const frame of input) frames.push(frame)
    writeFileSync(args.at(-1), 'fake mp4')
    assert.equal(file, '/opt/ffmpeg')
  }
  const tool = videoTool(resolveSettings({ outputDir: dir, ffmpegPath: '/opt/ffmpeg' }), { feed })
  const html = '<div style="display:flex;width:100%;height:100%;background:#00ff00"></div>'
  const out = await tool.execute({ name: 'card', width: 64, height: 36, fps: 24, fade: false, subtitles: 'talk.srt', scenes: [{ svg: svg('red'), seconds: 1, transition: 'cut' }, { html, seconds: 1 }] })
  assert.match(out, /^Saved MP4 64×36, 2 s, 2 scene\(s\) .*card-\d{8}T\d{6}Z\.mp4$/)
  assert.equal(frames.length, 48)
  assert.ok(frames.every((f) => f.length === 64 * 36 * 4))
  assert.deepEqual(rgbAt(frames[30], 64, 2, 2), [0, 255, 0])
  assert.deepEqual(rgbAt(frames[0], 64, 2, 2), [255, 0, 0])
  assert.notDeepEqual(frames[0], frames[23], 'the caption shows only in the first second')
  await assert.rejects(tool.execute({ scenes: [{ svg: '<svg><image href="http://x/a.png"/></svg>' }] }), /links to/)
  await assert.rejects(tool.execute({ scenes: [{ html: '<script></script>' }] }), /Refusing HTML/)
})

test('video_render: a missing ffmpeg gets a plain-language error', async () => {
  const tool = videoTool(resolveSettings({ outputDir: tempDir(), ffmpegPath: join(tmpdir(), 'no-such-ffmpeg') }))
  await assert.rejects(tool.execute({ width: 32, height: 18, scenes: [{ svg: svg('red'), seconds: 1 }] }), /needs ffmpeg on the server/)
})

test('video_render: real ffmpeg makes an H.264 + AAC MP4 of the right length', { skip: !hasFfmpeg && 'ffmpeg is not installed here' }, async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'tone.wav'), execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-f', 'wav', '-']))
  const tool = videoTool(resolveSettings({ outputDir: dir }))
  const html = '<style>@keyframes in{from{opacity:0}}.t{font-size:40px;color:#fff;animation:in 1s both}</style><div style="display:flex;width:100%;height:100%;background:#123"><div class="t">Hi</div></div>'
  const out = await tool.execute({ width: 320, height: 180, audio: 'tone.wav', captions: [{ start: 0, end: 2, text: 'caption' }], scenes: [{ svg: svg('red'), seconds: 1.5, transition: 'slide-left' }, { html, seconds: 1.5 }] })
  const path = out.slice(out.lastIndexOf(': ') + 2)
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', path], { encoding: 'utf8' })
  const info = JSON.parse(probe)
  assert.deepEqual(info.streams.map((s) => s.codec_name).sort(), ['aac', 'h264'])
  assert.equal(info.streams.find((s) => s.codec_name === 'h264').width, 320)
  assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.2, info.format.duration)
})
