/**
 * Local speech recognition with sherpa-onnx (Apache-2.0) on the CPU:
 * SenseVoice for Chinese, Cantonese, English, Japanese and Korean (with the
 * speaker's emotion and sounds such as laughter or music), Whisper
 * large-v3-turbo for other languages, voice activity detection, and speaker
 * diarization. Audio never leaves the server; models download once.
 */
import type { OfflineRecognizer } from 'sherpa-onnx-node'
import { download, type Download } from '../download.js'
import { onceUntilFailure } from '../once.js'
import { SPEECH_SAMPLE_RATE } from './decode.js'
import { ensureModel, MODELS, type ModelId, type ModelStore } from './models.js'
import { extrasOf, modelFor, recognizerConfig, type SpeechModel } from './recognize.js'
import { numberSpeakers, runSegmenter, tidyPieces, type Piece, type Segmenter } from './segments.js'
import type { Segment } from './transcript.js'

export interface EngineSettings extends ModelStore {
  model: SpeechModel
  threads: number
  /** Clustering distance for telling voices apart; higher merges more. */
  speakerThreshold: number
}

export interface TranscribeOptions {
  /** Language code such as "zh" or "en"; omitted means detect it. */
  language?: string
  /** Tell speakers apart. Default true. */
  speakers?: boolean
}

export type Transcriber = (samples: Float32Array, options: TranscribeOptions) => Promise<Segment[]>

export interface EngineDeps {
  segment?: Segmenter
  fetchBytes?: Download
}

/** The model that will read `language`, as a readable name. */
export const modelTitle = (settings: EngineSettings, language?: string) => MODELS[modelFor(settings.model, language)].title

export function createSpeechEngine(settings: EngineSettings, deps: EngineDeps = {}): Transcriber {
  const segment = deps.segment ?? runSegmenter
  const fetchBytes = deps.fetchBytes ?? download
  const sherpa = onceUntilFailure(() => import('sherpa-onnx-node').then((module) => module.default))
  const recognizers = new Map<string, () => Promise<OfflineRecognizer>>()

  function recognizer(model: SpeechModel, language: string | undefined): Promise<OfflineRecognizer> {
    const key = `${model}:${language ?? 'auto'}`
    if (!recognizers.has(key)) {
      recognizers.set(key, onceUntilFailure(async () => {
        const files = await ensureModel(model, settings, fetchBytes)
        return (await sherpa()).OfflineRecognizer.createAsync(recognizerConfig(model, files, language, settings.threads))
      }))
    }
    return recognizers.get(key)!()
  }

  async function piecesOf(samples: Float32Array, speakers: boolean): Promise<Piece[]> {
    const file = async (id: ModelId) => Object.values(await ensureModel(id, settings, fetchBytes))[0]
    const models: Record<string, string> = speakers
      ? { segmentation: await file('segmentation'), voiceprint: await file('voiceprint') }
      : { vad: await file('vad') }
    const mode = speakers ? 'speakers' : 'voice'
    return tidyPieces(await segment({ samples, mode, models, threads: settings.threads, speakerThreshold: settings.speakerThreshold }))
  }

  async function read(run: OfflineRecognizer, samples: Float32Array, piece: Piece): Promise<Segment | undefined> {
    const stream = run.createStream()
    const slice = samples.subarray(Math.floor(piece.start * SPEECH_SAMPLE_RATE), Math.ceil(piece.end * SPEECH_SAMPLE_RATE))
    stream.acceptWaveform({ sampleRate: SPEECH_SAMPLE_RATE, samples: slice })
    const result = await run.decodeAsync(stream)
    const segment = { start: piece.start, end: piece.end, text: result.text.trim(), speaker: piece.speaker, ...extrasOf(result) }
    return segment.text || segment.sound ? segment : undefined
  }

  return async (samples, options) => {
    const run = await recognizer(modelFor(settings.model, options.language), options.language)
    const segments: Segment[] = []
    for (const piece of await piecesOf(samples, options.speakers ?? true)) {
      const segment = await read(run, samples, piece)
      if (segment) segments.push(segment)
    }
    return numberSpeakers(segments)
  }
}
