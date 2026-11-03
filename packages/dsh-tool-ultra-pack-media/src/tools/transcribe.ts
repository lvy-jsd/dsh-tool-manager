/** audio_transcribe. */
import { runProgram, type RunProgram } from '../ffmpeg.js'
import { resolveInputFile } from '../files.js'
import { safeBaseName, saveFile } from '../output.js'
import { NAME_PARAMETER, type Settings, type ToolSpec } from '../settings.js'
import { decodeToSamples, SPEECH_SAMPLE_RATE } from '../speech/decode.js'
import { clock, timestampedText, toSrt } from '../speech/transcript.js'
import { createWhisperTranscriber, type Segment, type Transcriber } from '../speech/whisper.js'

export interface TranscribeDeps {
  run?: RunProgram
  transcriber?: Transcriber
}

const LANGUAGE = /^[a-z]{2,3}$/

function languageOf(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !LANGUAGE.test(value)) throw new Error('language must be a short code such as "zh", "en" or "ja".')
  return value
}

/** Shared by audio_transcribe and video_understand: file → timestamped segments. */
export function createSpeechReader(settings: Settings, deps: TranscribeDeps = {}) {
  const run = deps.run ?? runProgram
  const transcriber = deps.transcriber ?? createWhisperTranscriber(settings.speech)
  return async (path: string, language?: string): Promise<{ segments: Segment[]; seconds: number }> => {
    const decode = { ffmpegPath: settings.ffmpegPath, timeoutMs: settings.ffmpegTimeoutMs, maxSeconds: settings.speech.maxSeconds }
    const samples = await decodeToSamples(path, decode, run)
    if (!samples.length) return { segments: [], seconds: 0 }
    return { segments: await transcriber(samples, { language }), seconds: samples.length / SPEECH_SAMPLE_RATE }
  }
}

export function transcribeTool(settings: Settings, deps: TranscribeDeps = {}): ToolSpec {
  const readSpeech = createSpeechReader(settings, deps)
  async function transcribe(args: any): Promise<string> {
    const path = await resolveInputFile(settings, String(args.file ?? ''))
    const { segments, seconds } = await readSpeech(path, languageOf(args.language))
    if (!segments.length) return `No speech found in ${path} (${clock(seconds)} of audio).`
    const srt = await saveFile(settings.outputDir, safeBaseName(args.name, 'transcript'), 'srt', Buffer.from(toSrt(segments), 'utf8'))
    const head = `Transcript of ${path} (${clock(seconds)}, ${segments.length} segments, local model ${settings.speech.model}). Subtitles saved: ${srt}`
    return `${head}\n\n${timestampedText(segments, settings.speech.maxChars)}`
  }

  return {
    name: 'audio_transcribe',
    description: 'Turn the speech in an audio or video file into timestamped text, on this server with a local Whisper model (nothing is uploaded). '
      + 'Also saves the transcript as SRT subtitles. Use it to understand recordings, voice messages, podcasts or what is said in a video.',
    parameters: {
      file: { type: 'string', required: true, description: 'A file name from the output folder, or an absolute path inside an allowed input folder.' },
      language: { type: 'string', description: 'Spoken language code such as "zh" or "en". Default: detect.' },
      name: NAME_PARAMETER,
    },
    execute: transcribe,
  }
}
