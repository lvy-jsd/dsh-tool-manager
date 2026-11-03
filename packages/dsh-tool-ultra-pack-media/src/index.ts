/**
 * Tool Ultra media pack: images, music and video made from code, with no model API and no key.
 *
 * - svg_render: an SVG document (posters, cards, icons, diagrams) → PNG/JPEG/WebP.
 * - chart_render: a Vega-Lite chart spec with inline data → PNG/JPEG/WebP.
 * - music_render: a short score in a simple note notation → MIDI + WAV.
 * - video_render: SVG scenes plus an optional soundtrack → MP4 (host ffmpeg).
 * - audio_transcribe: speech in an audio or video file → timestamped text + SRT (local Whisper).
 *
 * The model writes the SVG, chart spec, score or scene list; this pack renders
 * it locally and saves the files into one configured folder. Nothing is
 * fetched: external links in an SVG and data URLs in a chart are refused, and
 * a video's soundtrack must already be in that folder.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveSettings, type Config, type ToolSpec } from './settings.js'
import { imageTools } from './tools/image.js'
import { musicTool } from './tools/music.js'
import { transcribeTool } from './tools/transcribe.js'
import { videoTool } from './tools/video.js'

export type { Config, ToolSpec } from './settings.js'
export { resolveSettings } from './settings.js'
export { checkSvg, rasterizeSvg } from './svg.js'
export { chartToSvg } from './chart.js'
export { safeBaseName, saveFile } from './output.js'
export { parseScore, pitchToMidi } from './audio/score.js'
export { scoreToMidi } from './audio/midi.js'
export { encodeWav, renderScore } from './audio/synth.js'
export { checkAudioName, ffmpegArgs, parseVideoRequest } from './video/scenes.js'
export { resolveInputFile, resolveOutputFile } from './files.js'
export { videoTool } from './tools/video.js'
export { transcribeTool } from './tools/transcribe.js'
export { decodeArgs } from './speech/decode.js'
export { clock, timestampedText, toSrt } from './speech/transcript.js'

export const name = 'tool-ultra-pack-media'
export const inject = ['tools']

export const TOOL_NAMES = ['svg_render', 'chart_render', 'music_render', 'video_render', 'audio_transcribe'] as const

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

export function createTools(config: Config = {}): ToolSpec[] {
  const settings = resolveSettings(config)
  return [...imageTools(settings), musicTool(settings), videoTool(settings), transcribeTool(settings)]
}

function registerPack(ctx: any, tools: string[]) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['toolCatalog'], (c: any) => {
    if (typeof c.toolCatalog?.registerToolPack !== 'function') return
    c.effect(() => c.toolCatalog.registerToolPack({
      id: 'media',
      title: 'Media',
      summary: 'Images, music and video made from code, and local speech-to-text: SVG and charts as images, scores as MIDI/WAV, SVG scenes as MP4, recordings as timestamped text. No API keys.',
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
