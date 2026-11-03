/**
 * The local speech models, all from the sherpa-onnx model releases on GitHub
 * (k2-fsa/sherpa-onnx). Each downloads once into the model cache, is checked
 * against its SHA-256 and, when it ships as a .tar.bz2, is unpacked there.
 */
import { access } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { download, fetchVerified, writeAtomically, type Download } from '../download.js'
import { unpackTarBz2 } from './archive.js'

export const MODEL_RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/'

export interface ModelSpec {
  title: string
  /** Path under the release URL. */
  path: string
  sha256: string
  megabytes: number
  /** The files to keep from a .tar.bz2; a single .onnx file keeps its own name. */
  files?: string[]
}

export const MODELS = {
  sensevoice: {
    title: 'SenseVoice Small (FunAudioLLM)',
    path: 'asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
    sha256: '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e',
    megabytes: 155,
    files: ['model.int8.onnx', 'tokens.txt'],
  },
  'whisper-turbo': {
    title: 'Whisper large-v3-turbo (OpenAI)',
    path: 'asr-models/sherpa-onnx-whisper-turbo.tar.bz2',
    sha256: 'b11acbbcd660b44a8e0df33724feb5aaa709cf65668f2823d59f656312544f22',
    megabytes: 538,
    files: ['turbo-encoder.int8.onnx', 'turbo-decoder.int8.onnx', 'turbo-tokens.txt'],
  },
  vad: {
    title: 'Silero VAD',
    path: 'asr-models/silero_vad.onnx',
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    megabytes: 1,
  },
  segmentation: {
    title: 'pyannote segmentation 3.0',
    path: 'speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
    sha256: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488',
    megabytes: 7,
    files: ['model.onnx'],
  },
  voiceprint: {
    title: '3D-Speaker ERes2Net',
    path: 'speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
    sha256: '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b',
    megabytes: 38,
  },
} as const satisfies Record<string, ModelSpec>

export type ModelId = keyof typeof MODELS

export interface ModelStore {
  cacheDir: string
  /** Base URL the release paths are appended to; a mirror of the GitHub releases also works. */
  mirror: string
}

const filesOf = (spec: ModelSpec) => spec.files ?? [basename(spec.path)]
const exists = (path: string) => access(path).then(() => true, () => false)

async function fetchModel(spec: ModelSpec, dir: string, store: ModelStore, fetchBytes: Download): Promise<void> {
  const url = store.mirror + spec.path
  const bytes = await fetchVerified(url, spec.sha256, (spec.megabytes + 20) * 1_048_576, fetchBytes).catch((error) => {
    throw new Error(`Could not download the speech model ${spec.title} from ${url} (${error.message}). Set modelMirror to a mirror of the sherpa-onnx releases.`)
  })
  const files = spec.files ? unpackTarBz2(bytes, spec.files) : new Map([[basename(spec.path), bytes]])
  for (const [name, content] of files) await writeAtomically(join(dir, name), content)
}

/** Absolute paths of a model's files, downloading them on first use. */
export async function ensureModel(id: ModelId, store: ModelStore, fetchBytes: Download = download): Promise<Record<string, string>> {
  const spec: ModelSpec = MODELS[id]
  const dir = join(store.cacheDir, 'sherpa-onnx', id)
  const paths = Object.fromEntries(filesOf(spec).map((name) => [name, join(dir, name)]))
  const present = await Promise.all(Object.values(paths).map(exists))
  if (!present.every(Boolean)) await fetchModel(spec, dir, store, fetchBytes)
  return paths
}
