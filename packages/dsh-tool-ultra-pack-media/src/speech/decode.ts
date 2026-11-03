/**
 * Any audio or video file → 16 kHz mono float samples, the input speech
 * models expect. ffmpeg does the decoding into a temporary file.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunProgram } from '../ffmpeg.js'

export const SPEECH_SAMPLE_RATE = 16_000

export interface DecodeOptions {
  ffmpegPath: string
  timeoutMs: number
  /** Only the first this-many seconds are decoded. */
  maxSeconds: number
}

export function decodeArgs(input: string, output: string, maxSeconds: number): string[] {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input, '-t', String(maxSeconds), '-vn',
    '-ac', '1', '-ar', String(SPEECH_SAMPLE_RATE), '-f', 'f32le', output,
  ]
}

function toFloat32(bytes: Buffer): Float32Array {
  const copy = new Uint8Array(bytes.byteLength - (bytes.byteLength % 4))
  copy.set(bytes.subarray(0, copy.byteLength))
  return new Float32Array(copy.buffer)
}

export async function decodeToSamples(input: string, options: DecodeOptions, run: RunProgram): Promise<Float32Array> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-media-speech-'))
  try {
    const output = join(dir, 'audio.f32')
    await run(options.ffmpegPath, decodeArgs(input, output, options.maxSeconds), options.timeoutMs)
    return toFloat32(await readFile(output))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
