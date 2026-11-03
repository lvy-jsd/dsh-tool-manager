/** Cutting a recording into pieces short enough to recognize: by voice activity, or by speaker turns. */
import { Worker } from 'node:worker_threads'

export interface Piece {
  start: number
  end: number
  /** Speaker number from diarization, in its own order. */
  speaker?: number
}

export interface SegmenterJob {
  samples: Float32Array
  mode: 'voice' | 'speakers'
  models: Record<string, string>
  threads: number
  speakerThreshold: number
}

/** Longest piece handed to a recognizer, in seconds (Whisper reads at most 30). */
export const MAX_PIECE_SECONDS = 25
const JOIN_GAP_SECONDS = 0.6

/** Joins a speaker's back-to-back turns and cuts any piece over the limit. */
export function tidyPieces(pieces: Piece[], maxSeconds = MAX_PIECE_SECONDS): Piece[] {
  const joined: Piece[] = []
  for (const piece of [...pieces].sort((a, b) => a.start - b.start)) {
    const last = joined.at(-1)
    const sameTurn = last && last.speaker === piece.speaker && piece.start - last.end < JOIN_GAP_SECONDS
    if (sameTurn && piece.end - last.start <= maxSeconds) last.end = piece.end
    else joined.push({ ...piece })
  }
  return joined.flatMap((piece) => {
    const count = Math.ceil((piece.end - piece.start) / maxSeconds)
    const step = (piece.end - piece.start) / count
    return Array.from({ length: count }, (_, i) => ({ ...piece, start: piece.start + i * step, end: piece.start + (i + 1) * step }))
  })
}

/** Renumbers speakers 1, 2, … in the order they first speak; with one speaker, drops the numbers. */
export function numberSpeakers<T extends { speaker?: number }>(items: T[]): T[] {
  const order = new Map<number, number>()
  for (const item of items) if (item.speaker !== undefined && !order.has(item.speaker)) order.set(item.speaker, order.size + 1)
  return items.map((item) => ({ ...item, speaker: order.size > 1 && item.speaker !== undefined ? order.get(item.speaker) : undefined }))
}

export type Segmenter = (job: SegmenterJob) => Promise<Piece[]>

/** Runs the segmenter in a worker thread. */
export const runSegmenter: Segmenter = (job) => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./segmenter-worker.js', import.meta.url), { workerData: job })
  worker.once('message', (reply: { pieces?: Piece[]; error?: string }) => (reply.error ? reject(new Error(reply.error)) : resolve(reply.pieces ?? [])))
  worker.once('error', reject)
  worker.once('exit', (code) => code && reject(new Error(`the speech segmenter stopped (exit code ${code})`)))
})
