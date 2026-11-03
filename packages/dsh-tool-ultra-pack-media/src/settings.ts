/** Pack config, its defaults, and the shape every tool spec shares. */
import type { ScoreLimits } from './audio/score.js'
import { DEFAULT_OUTPUT_DIR } from './output.js'
import type { RasterLimits } from './svg.js'
import type { VideoLimits } from './video/scenes.js'

export interface Config {
  /** Tools to leave out, by name. */
  disable?: string[]
  /** Folder that receives every generated file. */
  outputDir?: string
  /** Largest SVG source accepted, in bytes. */
  maxSvgBytes?: number
  /** Largest output image, in pixels (width × height). */
  maxPixels?: number
  /** Longest piece music_render accepts, in seconds. */
  maxMusicSeconds?: number
  /** Most notes music_render accepts in one piece. */
  maxMusicNotes?: number
  /** Longest video video_render makes, in seconds. */
  maxVideoSeconds?: number
  /** ffmpeg program used by video_render. */
  ffmpegPath?: string
  /** How long ffmpeg may run for one video, in milliseconds. */
  ffmpegTimeoutMs?: number
}

export interface Settings {
  outputDir: string
  svgLimits: RasterLimits
  scoreLimits: ScoreLimits
  videoLimits: VideoLimits
  ffmpegPath: string
  ffmpegTimeoutMs: number
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: any): Promise<string>
}

export function resolveSettings(config: Config): Settings {
  return {
    outputDir: config.outputDir ?? DEFAULT_OUTPUT_DIR,
    svgLimits: { maxSvgBytes: config.maxSvgBytes ?? 2_000_000, maxPixels: config.maxPixels ?? 4096 * 4096 },
    scoreLimits: { maxSeconds: config.maxMusicSeconds ?? 300, maxEvents: config.maxMusicNotes ?? 5000 },
    videoLimits: { maxSeconds: config.maxVideoSeconds ?? 180, maxScenes: 60, maxPixels: 1920 * 1080 },
    ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
    ffmpegTimeoutMs: config.ffmpegTimeoutMs ?? 300_000,
  }
}

export const NAME_PARAMETER = {
  type: 'string',
  description: 'Short file name hint, e.g. "birthday-card". Letters, digits, - and _ are kept.',
}
