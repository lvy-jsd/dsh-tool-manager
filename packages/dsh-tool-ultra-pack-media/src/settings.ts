/** Pack config, its defaults, and the shape every tool spec shares. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScoreLimits } from './audio/score.js'
import { DEFAULT_SOUNDFONT, type SoundFontSettings } from './audio/soundfont.js'
import type { HtmlSettings } from './html/render.js'
import { DEFAULT_GEMINI_KEY_FILE, DEFAULT_GEMINI_MODEL, type GeminiSettings } from './gemini/settings.js'
import { DEFAULT_OUTPUT_DIR } from './output.js'
import type { EngineSettings } from './speech/engine.js'
import { MODEL_RELEASES } from './speech/models.js'
import { SPEECH_MODELS, type SpeechModel } from './speech/recognize.js'
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
  /** Largest HTML page html_render accepts, in bytes. */
  maxHtmlBytes?: number
  /** Font files html_render loads before the host's own fonts (found with fontconfig). */
  fontFiles?: string[]
  /** Default page language for html_render; picks regional glyphs, e.g. Simplified Chinese for zh-CN. */
  lang?: string
  /** A local SoundFont (.sf2/.sf3) for music_render instead of the default download. */
  soundfont?: string
  /** Where the default SoundFont downloads from (a mirror of the same file also works). */
  soundfontUrl?: string
  /** Longest piece music_render accepts, in seconds. */
  maxMusicSeconds?: number
  /** Most notes music_render accepts in one piece. */
  maxMusicNotes?: number
  /** Longest video video_render makes, in seconds. */
  maxVideoSeconds?: number
  /** ffmpeg program used by video_render and audio_transcribe. */
  ffmpegPath?: string
  /** ffprobe program used by video_understand. */
  ffprobePath?: string
  /** How long one ffmpeg run may take, in milliseconds. */
  ffmpegTimeoutMs?: number
  /** sensevoice (default: Chinese, Cantonese, English, Japanese, Korean) or whisper-turbo (about 100 languages, slower). */
  speechModel?: SpeechModel
  /** Base URL of the sherpa-onnx model releases; a mirror of github.com/k2-fsa/sherpa-onnx/releases/download/ also works. */
  modelMirror?: string
  /** CPU threads for speech recognition. Default 4. */
  speechThreads?: number
  /** Where downloaded models and the SoundFont are kept. */
  modelCacheDir?: string
  /** Longest stretch of audio transcribed per call, in seconds. */
  maxTranscribeSeconds?: number
  /** Opt in to uploading audio and video files to Google. Default false. */
  geminiUploads?: boolean
  /** Optional Google API key, used only when geminiUploads is true. */
  geminiApiKey?: string
  /** Key file, checked before GEMINI_API_KEY. Default ~/.config/swiftnest/gemini.key. */
  geminiKeyFile?: string
  /** Gemini model used for native audio and video understanding. */
  geminiModel?: string
}

export interface SpeechSettings extends EngineSettings {
  maxSeconds: number
  /** Longest transcript returned to the model, in characters; the SRT file keeps all of it. */
  maxChars: number
}

export interface Settings {
  outputDir: string
  inputDirs: string[]
  svgLimits: RasterLimits
  html: HtmlSettings
  scoreLimits: ScoreLimits
  soundFont: SoundFontSettings
  videoLimits: VideoLimits
  ffmpegPath: string
  ffprobePath: string
  ffmpegTimeoutMs: number
  speech: SpeechSettings
  gemini: GeminiSettings
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: any): Promise<string>
}

const modelCacheDir = (config: Config) => config.modelCacheDir ?? join(homedir(), '.cache', 'dsh-tool-ultra', 'models')

function speechModel(value: unknown): SpeechModel {
  if (value === undefined) return 'sensevoice'
  if (!SPEECH_MODELS.includes(value as SpeechModel)) throw new Error(`speechModel must be one of ${SPEECH_MODELS.join(', ')}.`)
  return value as SpeechModel
}

function speechSettings(config: Config): SpeechSettings {
  return {
    model: speechModel(config.speechModel),
    mirror: config.modelMirror ?? MODEL_RELEASES,
    cacheDir: modelCacheDir(config),
    threads: config.speechThreads ?? 4,
    speakerThreshold: 0.9,
    maxSeconds: config.maxTranscribeSeconds ?? 1800,
    maxChars: 20_000,
  }
}

function htmlSettings(config: Config, folders: { outputDir: string; inputDirs: string[] }): HtmlSettings {
  return {
    maxHtmlBytes: config.maxHtmlBytes ?? 2_000_000,
    maxImageBytes: 25_000_000,
    maxPixels: config.maxPixels ?? 4096 * 4096,
    fontFiles: config.fontFiles ?? [],
    lang: config.lang ?? 'zh-CN',
    folders,
  }
}

export function resolveSettings(config: Config): Settings {
  const folders = { outputDir: config.outputDir ?? DEFAULT_OUTPUT_DIR, inputDirs: config.inputDirs ?? [] }
  return {
    ...folders,
    svgLimits: { maxSvgBytes: config.maxSvgBytes ?? 2_000_000, maxPixels: config.maxPixels ?? 4096 * 4096 },
    html: htmlSettings(config, folders),
    scoreLimits: { maxSeconds: config.maxMusicSeconds ?? 300, maxEvents: config.maxMusicNotes ?? 5000 },
    soundFont: { file: config.soundfont, url: config.soundfontUrl ?? DEFAULT_SOUNDFONT.url, cacheDir: modelCacheDir(config) },
    videoLimits: { maxSeconds: config.maxVideoSeconds ?? 180, maxScenes: 60, maxPixels: 1920 * 1080 },
    ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
    ffprobePath: config.ffprobePath ?? 'ffprobe',
    ffmpegTimeoutMs: config.ffmpegTimeoutMs ?? 300_000,
    speech: speechSettings(config),
    gemini: {
      uploads: config.geminiUploads ?? false,
      apiKey: config.geminiApiKey,
      keyFile: config.geminiKeyFile ?? DEFAULT_GEMINI_KEY_FILE,
      model: config.geminiModel ?? DEFAULT_GEMINI_MODEL,
    },
  }
}

export const NAME_PARAMETER = {
  type: 'string',
  description: 'Short file name hint, e.g. "birthday-card". Letters, digits, - and _ are kept.',
}
