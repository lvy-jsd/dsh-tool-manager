// Media pack: the DSH host deep-freezes tool arguments before execute(), so no tool may write into them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTools, musicTool, resolveSettings, TOOL_NAMES, transcribeTool, understandTool, videoTool } from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="red"/></svg>'

/** One realistic, nested call per tool, and the stand-ins that keep it off ffmpeg and model downloads. */
function calls(dir) {
  const settings = resolveSettings({ outputDir: dir, ffmpegPath: 'ffmpeg' })
  const feed = async (_file, args, input) => {
    for await (const _ of input);
    writeFileSync(args.at(-1), 'fake mp4')
  }
  const probe = JSON.stringify({ format: { duration: '1' }, streams: [{ codec_type: 'audio' }] })
  const decode = async (file, args) => {
    if (file === settings.ffprobePath) return probe
    writeFileSync(args.at(-1), Buffer.from(new Float32Array(16_000).buffer))
  }
  const transcriber = async () => [{ start: 0, end: 1, text: '你好' }]
  const tools = Object.fromEntries(createTools({ outputDir: dir }).map((t) => [t.name, t]))
  tools.music_render = musicTool(settings, { soundFont: async () => { throw new Error('offline in this test') } })
  tools.video_render = videoTool(settings, { feed })
  tools.audio_transcribe = transcribeTool(settings, { run: decode, transcriber })
  tools.video_understand = understandTool(settings, { run: decode, transcriber })
  return {
    tools,
    args: {
      html_render: { html: '<div style="display:flex;width:100%;height:100%;background:#00f"></div>', width: 32, height: 18 },
      svg_render: { svg: SVG },
      chart_render: { spec: { title: '中文图表', data: { values: [{ x: 'A', y: 2 }] }, mark: 'bar', encoding: { x: { field: 'x', type: 'nominal' }, y: { field: 'y', type: 'quantitative' } } } },
      music_render: { tempo: 120, tracks: [{ instrument: 'piano', notes: 'C4:1 [E4,G4]:1' }, { instrument: 'drums', notes: 'K:1 S:1' }] },
      video_render: { width: 32, height: 18, fps: 24, captions: [{ start: 0, end: 0.5, text: 'Hi' }], scenes: [{ svg: SVG, seconds: 0.5 }, { svg: SVG, seconds: 0.5 }] },
      audio_transcribe: { file: 'voice.wav' },
      video_understand: { file: 'voice.wav', frames: 4 },
    },
  }
}

for (const name of TOOL_NAMES) {
  test(`${name}: works with deep-frozen arguments, as the host passes them`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-media-frozen-'))
    writeFileSync(join(dir, 'voice.wav'), 'x')
    const { tools, args } = calls(dir)
    assert.match(await tools[name].execute(deepFreeze(args[name])), /Saved|Transcript|Speech/)
  })
}
