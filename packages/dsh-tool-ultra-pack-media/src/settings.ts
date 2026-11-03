/** Pack config, its defaults, and the shape every tool spec shares. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScoreLimits } from './audio/score.js'
import { DEFAULT_OUTPUT_DIR } from './output.js'
import type { WhisperConfig } from './speech/whisper.js'
import type { RasterLimits } from './svg.js'
import type { VideoLimits } from './video/scenes.js'

export interface Config {
  /** Tools to leave out, by name. */
  disable?: string[]
  /** Folder that receives every generated file. */
  outputDir?: string
  /** Extra folders whose files tools may read by absolute path (e.g. where uploads land). */
  inputDirs?: string[]
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
  /** ffmpeg program used by video_render and audio_transcribe. */
  ffmpegPath?: string
  /** How long one ffmpeg run may take, in milliseconds. */
  ffmpegTimeoutMs?: number
  /** Whisper model (an ONNX export on Hugging Face) used by audio_transcribe. */
  speechModel?: string
  /** Where speech models download from; a mirror such as https://hf-mirror.com/ also works. */
  modelHost?: string
  /** Where downloaded models are kept. */
  modelCacheDir?: string
  /** Longest stretch of audio transcribed per call, in seconds. */
  maxTranscribeSeconds?: number
}

export interface SpeechSettings extends WhisperConfig {
  maxSeconds: number
  /** Longest transcript returned to the model, in characters; the SRT file keeps all of it. */
  maxChars: number
}

export interface Settings {
  outputDir: string
  inputDirs: string[]
  svgLimits: RasterLimits
  scoreLimits: ScoreLimits
  videoLimits: VideoLimits
  ffmpegPath: string
  ffmpegTimeoutMs: number
  speech: SpeechSettings
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: any): Promise<string>
}

function speechSettings(config: Config): SpeechSettings {
  return {
    model: config.speechModel ?? 'onnx-community/whisper-small',
    modelHost: config.modelHost ?? 'https://huggingface.co/',
    cacheDir: config.modelCacheDir ?? join(homedir(), '.cache', 'dsh-tool-ultra', 'models'),
    maxSeconds: config.maxTranscribeSeconds ?? 1800,
    maxChars: 20_000,
  }
}

export function resolveSettings(config: Config): Settings {
  return {
    outputDir: config.outputDir ?? DEFAULT_OUTPUT_DIR,
    inputDirs: config.inputDirs ?? [],
    svgLimits: { maxSvgBytes: config.maxSvgBytes ?? 2_000_000, maxPixels: config.maxPixels ?? 4096 * 4096 },
    scoreLimits: { maxSeconds: config.maxMusicSeconds ?? 300, maxEvents: config.maxMusicNotes ?? 5000 },
    videoLimits: { maxSeconds: config.maxVideoSeconds ?? 180, maxScenes: 60, maxPixels: 1920 * 1080 },
    ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
    ffmpegTimeoutMs: config.ffmpegTimeoutMs ?? 300_000,
    speech: speechSettings(config),
  }
}

export const NAME_PARAMETER = {
  type: 'string',
  description: 'Short file name hint, e.g. "birthday-card". Letters, digits, - and _ are kept.',
}
