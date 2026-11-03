/**
 * Local speech-to-text with Whisper, run by transformers.js on the CPU
 * (ONNX Runtime). Audio never leaves the server; only the model files are
 * downloaded once, from `modelHost`, into `cacheDir`.
 */
import { SPEECH_SAMPLE_RATE } from './decode.js'

export interface Segment {
  start: number
  end: number
  text: string
}

export interface TranscribeOptions {
  /** Language code such as "zh" or "en"; omitted means detect it. */
  language?: string
}

export type Transcriber = (samples: Float32Array, options: TranscribeOptions) => Promise<Segment[]>

export interface WhisperConfig {
  /** Hugging Face model id of an ONNX Whisper export. */
  model: string
  /** Where models download from, e.g. https://huggingface.co/ or a mirror. */
  modelHost: string
  cacheDir: string
}

interface Chunk {
  timestamp: [number, number | null]
  text: string
}

function toSegments(chunks: Chunk[], duration: number): Segment[] {
  return chunks
    .map((c) => ({ start: c.timestamp[0], end: c.timestamp[1] ?? duration, text: c.text.trim() }))
    .filter((s) => s.text)
}

/** A transcriber that loads the model on first use and reuses it after. */
export function createWhisperTranscriber(config: WhisperConfig): Transcriber {
  let recognizer: Promise<any> | undefined
  async function load() {
    const transformers = await import('@huggingface/transformers')
    transformers.env.remoteHost = config.modelHost
    transformers.env.cacheDir = config.cacheDir
    return transformers.pipeline('automatic-speech-recognition', config.model, { dtype: 'q8' } as any)
  }
  return async (samples, options) => {
    recognizer ??= load().catch((error) => {
      recognizer = undefined
      throw new Error(`Could not load the speech model ${config.model} from ${config.modelHost}: ${error.message}`)
    })
    const run = await recognizer
    const result = await run(samples, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
      ...(options.language ? { language: options.language } : {}),
    })
    return toSegments(result.chunks ?? [], samples.length / SPEECH_SAMPLE_RATE)
  }
}
