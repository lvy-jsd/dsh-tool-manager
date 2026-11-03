/**
 * A storyboard: frames sampled evenly through a video, each labelled with its
 * time, laid out on one image so a vision model (or a person) can read the
 * whole video at a glance.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { shortTime } from '../speech/transcript.js'

export const CELL = { width: 320, height: 180 }
export const COLUMNS = 4

/** Time of each sampled frame: the start of each equal slice of the video. */
export function frameTimes(duration: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i * duration) / count)
}

/** ffmpeg arguments that write `count` evenly spaced, cell-sized JPEG frames into `dir`. */
export function extractArgs(file: string, dir: string, count: number, duration: number): string[] {
  const scale = `scale=${CELL.width}:${CELL.height}:force_original_aspect_ratio=decrease`
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', file, '-an', '-vf', `fps=${count}/${duration},${scale}`, '-frames:v', String(count),
    join(dir, 'frame-%02d.jpg'),
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
