/**
 * Checks a video request and turns it into ffmpeg arguments.
 *
 * A video is a list of scenes, each an SVG frame shown for some seconds,
 * with an optional soundtrack taken from the pack's own output folder.
 * Everything here is pure, so the argument list can be tested without ffmpeg.
 */
import { basename, extname } from 'node:path'

export const FPS = 30
const FADE_SECONDS = 0.4
const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg']

export interface VideoLimits {
  maxSeconds: number
  maxScenes: number
  maxPixels: number
}

export interface Scene {
  svg: string
  seconds: number
}

export interface VideoRequest {
  scenes: Scene[]
  width: number
  height: number
  /** File name of a soundtrack inside the output folder, if any. */
  audio?: string
  fade: boolean
}

function checkSize(width: number, height: number, maxPixels: number) {
  for (const [label, value] of [['width', width], ['height', height]] as const) {
    if (!Number.isInteger(value) || value < 16 || value % 2 !== 0) throw new Error(`${label} must be an even whole number of pixels, at least 16.`)
  }
  if (width * height > maxPixels) throw new Error(`${width}×${height} is over the ${maxPixels}-pixel limit.`)
}

function checkScene(raw: any, index: number): Scene {
  if (typeof raw?.svg !== 'string' || !raw.svg.trim()) throw new Error(`Scene ${index + 1} needs an svg.`)
  const seconds = raw.seconds ?? 3
  if (!(typeof seconds === 'number' && seconds >= 0.5 && seconds <= 60)) throw new Error(`Scene ${index + 1}: seconds must be between 0.5 and 60.`)
  return { svg: raw.svg, seconds }
}

/** A bare file name with an audio extension; paths are refused. */
export function checkAudioName(name: unknown): string {
  const text = String(name ?? '')
  if (!text || basename(text) !== text || text.startsWith('.')) throw new Error('audio must be the file name of a sound saved by music_render (no folders), e.g. "song-20261103T080000Z.wav".')
  if (!AUDIO_EXTENSIONS.includes(extname(text).toLowerCase())) throw new Error(`audio must be one of ${AUDIO_EXTENSIONS.join(', ')}.`)
  return text
}

export function parseVideoRequest(args: any, limits: VideoLimits): VideoRequest {
  const scenes = Array.isArray(args.scenes) ? args.scenes : []
  if (!scenes.length || scenes.length > limits.maxScenes) throw new Error(`Give 1 to ${limits.maxScenes} scenes.`)
  const width = args.width ?? 1280
  const height = args.height ?? 720
  checkSize(width, height, limits.maxPixels)
  const parsed = scenes.map(checkScene)
  const total = totalSeconds(parsed)
  if (total > limits.maxSeconds) throw new Error(`The video would be ${total} seconds long, over the ${limits.maxSeconds}-second limit.`)
  const audio = args.audio === undefined ? undefined : checkAudioName(args.audio)
  return { scenes: parsed, width, height, audio, fade: args.fade ?? true }
}

export function totalSeconds(scenes: Scene[]): number {
  return scenes.reduce((sum, s) => sum + s.seconds, 0)
}

function sceneFilter(scene: Scene, index: number, fade: boolean): string {
  const steps = [`fps=${FPS}`, 'format=yuv420p']
  if (fade && scene.seconds >= 3 * FADE_SECONDS) {
    steps.push(`fade=t=in:st=0:d=${FADE_SECONDS}`, `fade=t=out:st=${scene.seconds - FADE_SECONDS}:d=${FADE_SECONDS}`)
  }
  return `[${index}:v]${steps.join(',')}[v${index}]`
}

/** ffmpeg arguments that turn scene PNGs (and a soundtrack) into an H.264/AAC MP4. */
export function ffmpegArgs(request: VideoRequest, framePaths: string[], audioPath: string | undefined, outPath: string): string[] {
  const inputs = request.scenes.flatMap((scene, i) => ['-loop', '1', '-framerate', String(FPS), '-t', String(scene.seconds), '-i', framePaths[i]])
  const filters = request.scenes.map((scene, i) => sceneFilter(scene, i, request.fade))
  const labels = request.scenes.map((_, i) => `[v${i}]`).join('')
  const graph = [...filters, `${labels}concat=n=${request.scenes.length}:v=1:a=0[v]`].join(';')
  const audioInput = audioPath ? ['-i', audioPath] : []
  const audioOutput = audioPath ? ['-map', `${request.scenes.length}:a`, '-c:a', 'aac', '-b:a', '160k'] : []
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    ...inputs,
    ...audioInput,
    '-filter_complex', graph, '-map', '[v]',
    ...audioOutput,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-t', String(totalSeconds(request.scenes)), '-movflags', '+faststart',
    outPath,
  ]
}
