/** audio_transcribe. */
import { runProgram, type RunProgram } from '../ffmpeg.js'
import { resolveInputFile } from '../files.js'
import { engineParameter, mediaPrompt, runMediaEngine } from '../gemini/engine.js'
import { GeminiError } from '../gemini/client.js'
import { mediaMessages } from '../gemini/messages.js'
import { safeBaseName, saveFile } from '../output.js'
import { NAME_PARAMETER, type Settings, type ToolSpec } from '../settings.js'
import { decodeToSamples, SPEECH_SAMPLE_RATE } from '../speech/decode.js'
import { createSpeechEngine, modelTitle, type TranscribeOptions, type Transcriber } from '../speech/engine.js'
import { clock, timestampedText, toSrt, type Segment } from '../speech/transcript.js'
import { parseSrt } from '../video/captions.js'
import { describeMedia, parseProbe, probeArgs } from '../video/probe.js'

export interface TranscribeDeps {
  run?: RunProgram
  transcriber?: Transcriber
}

const LANGUAGE = /^[a-z]{2,3}$/

export function languageOf(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !LANGUAGE.test(value)) throw new Error('language must be a short code such as "zh", "en" or "ja".')
  return value
}

/** Shared by audio_transcribe and video_understand: file → timestamped segments. */
export function createSpeechReader(settings: Settings, deps: TranscribeDeps = {}) {
  const run = deps.run ?? runProgram
  const transcriber = deps.transcriber ?? createSpeechEngine(settings.speech)
  return async (path: string, options: TranscribeOptions): Promise<{ segments: Segment[]; seconds: number }> => {
    const decode = { ffmpegPath: settings.ffmpegPath, timeoutMs: settings.ffmpegTimeoutMs, maxSeconds: settings.speech.maxSeconds }
    const samples = await decodeToSamples(path, decode, run)
    if (!samples.length) return { segments: [], seconds: 0 }
    return { segments: await transcriber(samples, options), seconds: samples.length / SPEECH_SAMPLE_RATE }
  }
}

export function describeSpeakers(segments: Segment[]): string {
  const count = new Set(segments.map((s) => s.speaker).filter(Boolean)).size
  return count > 1 ? `${count} speakers` : 'one speaker'
}

export function transcribeTool(settings: Settings, deps: TranscribeDeps = {}): ToolSpec {
  const readSpeech = createSpeechReader(settings, deps)
  const run = deps.run ?? runProgram

  async function localTranscript(path: string, language: string | undefined, args: any): Promise<string> {
    const { segments, seconds } = await readSpeech(path, { language, speakers: args.speakers !== false })
    if (!segments.length) return `No speech found in ${path} (${clock(seconds)} of audio).`
    const srt = await saveFile(settings.outputDir, safeBaseName(args.name, 'transcript'), 'srt', Buffer.from(toSrt(segments), 'utf8'))
    const head = `Transcript of ${path} (${clock(seconds)}, ${describeSpeakers(segments)}, ${segments.length} segments, local model ${modelTitle(settings.speech, language)}). Subtitles saved: ${srt}`
    return `${head}\n\n${timestampedText(segments, settings.speech.maxChars)}`
  }

  async function geminiTranscript(text: string, args: any): Promise<string> {
    const segments = parseSrt(text.replace(/^```(?:srt)?\s*\n?|\n?```\s*$/g, ''))
    if (!segments.length || segments.some((s) => !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start)) throw new GeminiError('invalid')
    const srt = await saveFile(settings.outputDir, safeBaseName(args.name, 'transcript'), 'srt', Buffer.from(toSrt(segments), 'utf8'))
    return `${mediaMessages(settings.html.lang).subtitles(srt)}\n\n${timestampedText(segments, settings.speech.maxChars)}`
  }

  async function transcribe(args: any): Promise<string> {
    const path = await resolveInputFile(settings, String(args.file ?? ''))
    const language = languageOf(args.language)
    const info = parseProbe(await run(settings.ffprobePath, probeArgs(path), settings.ffmpegTimeoutMs))
    const facts = describeMedia(path, info)
    return runMediaEngine(settings, args.engine, path, mediaPrompt(settings, 'audio', args),
      async () => `${facts}\n\n${await localTranscript(path, language, args)}`,
      async (text) => `${facts}\n\n${await geminiTranscript(text, args)}`)
  }

  return {
    name: 'audio_transcribe',
    description: mediaMessages(settings.html.lang).audio,
    parameters: {
      file: { type: 'string', required: true, description: 'A file name from the output folder, or an absolute path inside an allowed input folder.' },
      engine: engineParameter(settings),
      language: { type: 'string', description: 'Spoken language code such as "zh", "yue", "en" or "fr". Default: detect (Chinese, Cantonese, English, Japanese, Korean).' },
      speakers: { type: 'boolean', description: 'Tell speakers apart. Default true; false is faster for a single voice.' },
      name: NAME_PARAMETER,
    },
    execute: transcribe,
  }
}
