/**
 * Tool Ultra media pack: images, music and video made from code, with no model API and no key.
 *
 * - html_render: an HTML/CSS page (posters, cards, slides) → PNG/JPEG/WebP, or its CSS animations → GIF/WebP.
 * - svg_render: an SVG document (posters, cards, icons, diagrams) → PNG/JPEG/WebP.
 * - chart_render: a Vega-Lite chart spec with inline data → PNG/JPEG/WebP.
 * - music_render: a short score in a simple note notation → MIDI + WAV.
 * - video_render: SVG scenes plus an optional soundtrack → MP4 (host ffmpeg).
 * - audio_transcribe: speech in an audio or video file → timestamped text + SRT (local Whisper).
 * - video_understand: a video's facts, a timestamped storyboard image and its transcript.
 *
 * The model writes the HTML, SVG, chart spec, score or scene list; this pack renders
 * it locally and saves the files into one configured folder. Nothing is
 * fetched: external links in HTML or SVG and data URLs in a chart are refused, and
 * a video's soundtrack must already be in that folder.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveSettings, type Config, type ToolSpec } from './settings.js'
import { htmlTool } from './tools/html.js'
import { imageTools } from './tools/image.js'
import { musicTool } from './tools/music.js'
import { transcribeTool } from './tools/transcribe.js'
import { understandTool } from './tools/understand.js'
import { videoTool } from './tools/video.js'

export type { Config, ToolSpec } from './settings.js'
export { resolveSettings } from './settings.js'
export { checkSvg, rasterizeSvg } from './svg.js'
export { checkHtml } from './html/check.js'
export { chooseFonts } from './html/fonts.js'
export { createHtmlRenderer } from './html/render.js'
export { htmlTool } from './tools/html.js'
export { chartToSvg } from './chart.js'
export { safeBaseName, saveFile } from './output.js'
export { parseScore, pitchToMidi } from './audio/score.js'
export { scoreToMidi } from './audio/midi.js'
export { encodeWav, renderScore } from './audio/synth.js'
export { checkAudioName, ffmpegArgs, parseVideoRequest } from './video/scenes.js'
export { resolveInputFile, resolveOutputFile } from './files.js'
export { videoTool } from './tools/video.js'
export { transcribeTool } from './tools/transcribe.js'
export { understandTool } from './tools/understand.js'
export { parseProbe, probeArgs } from './video/probe.js'
export { buildStoryboard, extractArgs, frameTimes } from './video/storyboard.js'
export { decodeArgs } from './speech/decode.js'
export { clock, shortTime, timestampedText, toSrt } from './speech/transcript.js'

export const name = 'tool-ultra-pack-media'
export const inject = ['tools']

export const TOOL_NAMES = ['html_render', 'svg_render', 'chart_render', 'music_render', 'video_render', 'audio_transcribe', 'video_understand'] as const

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

export function createTools(config: Config = {}): ToolSpec[] {
  const settings = resolveSettings(config)
  return [htmlTool(settings), ...imageTools(settings), musicTool(settings), videoTool(settings), transcribeTool(settings), understandTool(settings)]
}

function registerPack(ctx: any, tools: string[]) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['toolCatalog'], (c: any) => {
    if (typeof c.toolCatalog?.registerToolPack !== 'function') return
    c.effect(() => c.toolCatalog.registerToolPack({
      id: 'media',
      title: 'Media',
      summary: 'Images, music and video made from code, and local understanding: HTML/CSS designs, SVG and charts as images, CSS animations as GIFs, scores as MIDI/WAV, SVG scenes as MP4; recordings as text, videos as storyboards. No API keys.',
      source: '@lvy-jsd/dsh-tool-ultra-pack-media',
      tools,
    }))
  })
}

export function apply(ctx: any, config: Config = {}) {
  const disabled = new Set(config.disable ?? [])
  const specs = createTools(config).filter((spec) => !disabled.has(spec.name))
  // List the pack in Tool Ultra's panel and make it loadable as pack:media.
  registerPack(ctx, specs.map((spec) => spec.name))
  for (const spec of specs) {
    ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: (args: unknown) => spec.execute(args),
    } as any))
  }
}

export default { name, inject, apply }
