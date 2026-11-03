/**
 * A storyboard: key frames of a video, each labelled with its time, laid out
 * on one image so a vision model (or a person) can read the whole video at a
 * glance. Frames follow the edit: each shot gets at least one frame, taken
 * from its middle, and long shots get more.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

export const CELL = { width: 320, height: 180 }
export const COLUMNS = 4
/** Scene-change score (0-1, how different a frame is from the one before) worth considering as a cut. */
const CUT_SCORE = 0.1

export interface Cut {
  time: number
  score: number
}

/** ffmpeg arguments that print every likely cut, judged on a small grey copy of each frame. */
export function cutArgs(file: string): string[] {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-i', file, '-an', '-vf', `scale=160:-2,select='gt(scene,${CUT_SCORE})',metadata=print:file=-`, '-f', 'null', '-',
  ]
}

/** Reads ffmpeg's "pts_time:12.5" / "lavfi.scene_score=0.64" pairs. */
export function parseCuts(printed: string): Cut[] {
  const cuts: Cut[] = []
  for (const match of printed.matchAll(/pts_time:([\d.]+)\s+lavfi\.scene_score=([\d.]+)/g)) {
    cuts.push({ time: Number(match[1]), score: Number(match[2]) })
  }
  return cuts
}

export interface FramePlan {
  /** When each frame is taken, in order. */
  times: number[]
  /** The cuts the frames follow, in order. */
  cuts: number[]
}

/** Spreads `count` frames over the shots between the strongest cuts: one per shot, extra ones to the longest. */
export function planFrames(duration: number, found: Cut[], count: number): FramePlan {
  const strongest = [...found].sort((a, b) => b.score - a.score).slice(0, count - 1)
  const cuts = strongest.map((c) => c.time).filter((t) => t > 0 && t < duration).sort((a, b) => a - b)
  const edges = [0, ...cuts, duration]
  const shots = edges.slice(1).map((end, i) => ({ start: edges[i], length: end - edges[i], frames: 1 }))
  for (let left = count - shots.length; left > 0; left--) {
    const roomiest = shots.reduce((best, shot) => (shot.length / shot.frames > best.length / best.frames ? shot : best))
    roomiest.frames++
  }
  const times = shots.flatMap((shot) => Array.from({ length: shot.frames }, (_, i) => shot.start + ((i + 0.5) * shot.length) / shot.frames))
  return { times, cuts }
}

/** ffmpeg arguments that write the first frame at or after each time, cell-sized, into `dir`. */
export function extractArgs(file: string, dir: string, times: number[]): string[] {
  const at = (t: number) => `gte(t,${t.toFixed(3)})*(isnan(prev_t)+lt(prev_t,${t.toFixed(3)}))`
  const scale = `scale=${CELL.width}:${CELL.height}:force_original_aspect_ratio=decrease`
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', file, '-an', '-vf', `select='${times.map(at).join('+')}',${scale}`,
    '-fps_mode', 'vfr', '-frames:v', String(times.length), join(dir, 'frame-%02d.jpg'),
  ]
}

export async function listFrames(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((f) => /^frame-\d+\.jpg$/.test(f)).sort().map((f) => join(dir, f))
}

function label(text: string): Buffer {
  const width = 12 + text.length * 11
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="26"><rect width="${width}" height="26" rx="4" fill="#000" fill-opacity="0.65"/><text x="6" y="19" font-family="sans-serif" font-size="17" fill="#fff">${text}</text></svg>`)
}

async function cell(frame: string, time: string): Promise<Buffer> {
  const background = { r: 0, g: 0, b: 0 }
  return sharp(frame)
    .resize(CELL.width, CELL.height, { fit: 'contain', background })
    .composite([{ input: label(time), left: 6, top: CELL.height - 32 }])
    .png()
    .toBuffer()
}

/** Lays the frames out left to right, top to bottom, each with its time label, and returns a JPEG. */
export async function buildStoryboard(frames: string[], labels: string[]): Promise<Buffer> {
  const rows = Math.ceil(frames.length / COLUMNS)
  const columns = Math.min(COLUMNS, frames.length)
  const cells = await Promise.all(frames.map((frame, i) => cell(frame, labels[i] ?? '')))
  const canvas = { width: columns * CELL.width, height: rows * CELL.height, channels: 3 as const, background: '#000000' }
  const placed = cells.map((input, i) => ({ input, left: (i % COLUMNS) * CELL.width, top: Math.floor(i / COLUMNS) * CELL.height }))
  return sharp({ create: canvas }).composite(placed).jpeg({ quality: 85 }).toBuffer()
}
