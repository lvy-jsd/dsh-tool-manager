/**
 * Finds where speech is, off the main thread: sherpa-onnx's voice activity
 * detection and speaker diarization are synchronous and take seconds per
 * minute of audio, which would otherwise stall the whole host.
 */
import { parentPort, workerData } from 'node:worker_threads'
import sherpa from 'sherpa-onnx-node'
import { SPEECH_SAMPLE_RATE } from './decode.js'
import type { Piece, SegmenterJob } from './segments.js'

const WINDOW = 512

function voicePieces(job: SegmenterJob): Piece[] {
  const vad = new sherpa.Vad({
    sileroVad: { model: job.models.vad, threshold: 0.5, minSilenceDuration: 0.4, minSpeechDuration: 0.25, maxSpeechDuration: 25, windowSize: WINDOW },
    sampleRate: SPEECH_SAMPLE_RATE, numThreads: job.threads, debug: 0,
  }, 60)
  const pieces: Piece[] = []
  const drain = () => {
    for (; !vad.isEmpty(); vad.pop()) {
      const { start, samples } = vad.front(false)
      pieces.push({ start: start / SPEECH_SAMPLE_RATE, end: (start + samples.length) / SPEECH_SAMPLE_RATE })
    }
  }
  for (let i = 0; i < job.samples.length; i += WINDOW) {
    vad.acceptWaveform(job.samples.subarray(i, i + WINDOW))
    drain()
  }
  vad.flush()
  drain()
  return pieces
}

function speakerPieces(job: SegmenterJob): Piece[] {
  const diarization = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: job.models.segmentation }, numThreads: job.threads, debug: 0 },
    embedding: { model: job.models.voiceprint, numThreads: job.threads, debug: 0 },
    clustering: { numClusters: -1, threshold: job.speakerThreshold },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  })
  return diarization.process(job.samples)
}

const job = workerData as SegmenterJob
try {
  parentPort?.postMessage({ pieces: job.mode === 'speakers' ? speakerPieces(job) : voicePieces(job) })
} catch (error: any) {
  parentPort?.postMessage({ error: String(error?.message ?? error) })
}
