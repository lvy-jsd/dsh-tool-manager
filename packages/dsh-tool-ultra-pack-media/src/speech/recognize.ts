/** Recognizer setup for each speech model, and the extras SenseVoice hears besides words. */
import type { RecognizerResult } from 'sherpa-onnx-node'
import { SPEECH_SAMPLE_RATE } from './decode.js'

export const SPEECH_MODELS = ['sensevoice', 'whisper-turbo'] as const
export type SpeechModel = (typeof SPEECH_MODELS)[number]

/** Languages SenseVoice reads; anything else goes to Whisper. */
export const SENSEVOICE_LANGUAGES = new Set(['zh', 'en', 'ja', 'ko', 'yue'])

export function modelFor(configured: SpeechModel, language: string | undefined): SpeechModel {
  return language && !SENSEVOICE_LANGUAGES.has(language) ? 'whisper-turbo' : configured
}

export function recognizerConfig(model: SpeechModel, files: Record<string, string>, language: string | undefined, threads: number): object {
  const common = { numThreads: threads, provider: 'cpu', debug: 0 }
  const featConfig = { sampleRate: SPEECH_SAMPLE_RATE, featureDim: 80 }
  if (model === 'sensevoice') {
    const senseVoice = { model: files['model.int8.onnx'], language: language ?? 'auto', useInverseTextNormalization: 1 }
    return { featConfig, modelConfig: { senseVoice, tokens: files['tokens.txt'], ...common } }
  }
  const whisper = { encoder: files['turbo-encoder.int8.onnx'], decoder: files['turbo-decoder.int8.onnx'], language: language ?? '', task: 'transcribe' }
  return { featConfig, modelConfig: { whisper, tokens: files['turbo-tokens.txt'], ...common } }
}

const EMOTIONS: Record<string, string> = {
  HAPPY: 'happy', SAD: 'sad', ANGRY: 'angry', FEARFUL: 'fearful', DISGUSTED: 'disgusted', SURPRISED: 'surprised',
}
const SOUNDS: Record<string, string> = {
  BGM: 'music', Applause: 'applause', Laughter: 'laughter', Cry: 'crying', Sneeze: 'sneezing', Breath: 'breathing', Cough: 'coughing',
}
const tag = (value: string | undefined) => value?.replace(/^<\|/, '').replace(/\|>$/, '') ?? ''

/** SenseVoice's emotion and sound-event tags, without the neutral ones (Whisper has none). */
export function extrasOf(result: RecognizerResult): { emotion?: string; sound?: string } {
  const emotion = EMOTIONS[tag(result.emotion)]
  const sound = SOUNDS[tag(result.event)]
  return { ...(emotion ? { emotion } : {}), ...(sound ? { sound } : {}) }
}
