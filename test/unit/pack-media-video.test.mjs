// Media pack, video: request checks, the ffmpeg argument list, soundtrack confinement,
// the tool with a stand-in ffmpeg, and a real render when ffmpeg is installed (CI installs it on Linux).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAudioName, ffmpegArgs, parseVideoRequest, resolveOutputFile, resolveSettings, videoTool } from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

const LIMITS = { maxSeconds: 180, maxScenes: 60, maxPixels: 1920 * 1080 }
const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${fill}"/></svg>`
const tempDir = () => mkdtempSync(join(tmpdir(), 'pack-media-video-'))
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

test('video: requests are checked before anything renders', () => {
  const ok = parseVideoRequest({ scenes: [{ svg: svg('red') }, { svg: svg('blue'), seconds: 1.5 }] }, LIMITS)
  assert.deepEqual([ok.width, ok.height, ok.fade, ok.scenes.map((s) => s.seconds)], [1280, 720, true, [3, 1.5]])
  assert.throws(() => parseVideoRequest({ scenes: [] }, LIMITS), /Give 1 to 60 scenes/)
  assert.throws(() => parseVideoRequest({ scenes: [{ seconds: 2 }] }, LIMITS), /Scene 1 needs an svg/)
  assert.throws(() => parseVideoRequest({ scenes: [{ svg: svg('red'), seconds: 0.1 }] }, LIMITS), /seconds must be between 0.5 and 60/)
  assert.throws(() => parseVideoRequest({ scenes: [{ svg: svg('red') }], width: 641 }, LIMITS), /width must be an even/)
  assert.throws(() => parseVideoRequest({ scenes: [{ svg: svg('red') }], width: 3840, height: 2160 }, LIMITS), /pixel limit/)
  const long = Array.from({ length: 4 }, () => ({ svg: svg('red'), seconds: 60 }))
  assert.throws(() => parseVideoRequest({ scenes: long }, LIMITS), /240 seconds long, over the 180-second limit/)
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
  if (linked) await assert.rejects(resolveOutputFile(dir, 'link.wav'), /not inside the output folder/)
  await assert.rejects(resolveOutputFile(dir, 'missing.wav'), /Make the soundtrack with music_render first/)
})

test('video: ffmpeg arguments loop each frame, fade long scenes and map the soundtrack', () => {
  const request = parseVideoRequest({ scenes: [{ svg: svg('red'), seconds: 2 }, { svg: svg('blue'), seconds: 1 }], width: 640, height: 360 }, LIMITS)
  const args = ffmpegArgs(request, ['/t/0.png', '/t/1.png'], '/out/song.wav', '/t/video.mp4')
  const joined = args.join(' ')
  assert.match(joined, /^-nostdin .* -loop 1 -framerate 30 -t 2 -i \/t\/0\.png -loop 1 -framerate 30 -t 1 -i \/t\/1\.png -i \/out\/song\.wav /)
  const graph = args[args.indexOf('-filter_complex') + 1]
  assert.equal(graph, '[0:v]fps=30,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=1.6:d=0.4[v0];[1:v]fps=30,format=yuv420p[v1];[v0][v1]concat=n=2:v=1:a=0[v]')
  assert.match(joined, /-map \[v\] -map 2:a -c:a aac/)
  assert.match(joined, /-t 3 -movflags \+faststart \/t\/video\.mp4$/)
  const silent = ffmpegArgs({ ...request, fade: false }, ['/t/0.png', '/t/1.png'], undefined, '/t/v.mp4')
  assert.ok(!silent.includes('-c:a') && !silent.join(' ').includes('fade='))
})

test('video_render: renders frames, runs ffmpeg and saves the MP4', async () => {
  const dir = tempDir()
  let seen
  const fakeFfmpeg = async (file, args) => {
    seen = { file, args }
    const frame = readFileSync(args[args.indexOf('-i') + 1])
    assert.equal(frame.subarray(1, 4).toString('ascii'), 'PNG')
    writeFileSync(args.at(-1), 'fake mp4')
  }
  const tool = videoTool(resolveSettings({ outputDir: dir, ffmpegPath: '/opt/ffmpeg' }), fakeFfmpeg)
  const out = await tool.execute({ name: 'card', width: 320, height: 180, scenes: [{ svg: svg('red'), seconds: 2 }] })
  assert.equal(seen.file, '/opt/ffmpeg')
  assert.match(out, /^Saved MP4 320×180, 2 s, 1 scene\(s\) .*card-\d{8}T\d{6}Z\.mp4$/)
  assert.equal(readFileSync(out.slice(out.lastIndexOf(': ') + 2), 'utf8'), 'fake mp4')
  await assert.rejects(tool.execute({ scenes: [{ svg: '<svg><image href="http://x/a.png"/></svg>' }] }), /links to/)
})

test('video_render: a missing ffmpeg gets a plain-language error', async () => {
  const tool = videoTool(resolveSettings({ outputDir: tempDir(), ffmpegPath: join(tmpdir(), 'no-such-ffmpeg') }))
  await assert.rejects(tool.execute({ scenes: [{ svg: svg('red'), seconds: 1 }] }), /needs ffmpeg on the server/)
})

test('video_render: real ffmpeg makes an H.264 + AAC MP4 of the right length', { skip: !hasFfmpeg && 'ffmpeg is not installed here' }, async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'tone.wav'), execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-f', 'wav', '-']))
  const tool = videoTool(resolveSettings({ outputDir: dir }))
  const out = await tool.execute({ width: 320, height: 180, audio: 'tone.wav', scenes: [{ svg: svg('red'), seconds: 1.5 }, { svg: svg('blue'), seconds: 1.5 }] })
  const path = out.slice(out.lastIndexOf(': ') + 2)
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', path], { encoding: 'utf8' })
  const info = JSON.parse(probe)
  assert.deepEqual(info.streams.map((s) => s.codec_name).sort(), ['aac', 'h264'])
  assert.equal(info.streams.find((s) => s.codec_name === 'h264').width, 320)
  assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.2, info.format.duration)
})
