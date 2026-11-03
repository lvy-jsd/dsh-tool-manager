/**
 * Checks a video request. A video is a list of scenes, each drawn as SVG,
 * as an HTML page with CSS animations, or as a photo with a slow camera move,
 * joined by transitions, with optional captions and a soundtrack. Everything
 * here is pure, so requests can be tested without rendering.
 */
import { basename, extname } from 'node:path'
import { CAPTION_STYLES, checkCaptions, type Caption, type CaptionStyle } from './captions.js'
import { planTimeline, TRANSITIONS, type Timeline, type TransitionKind } from './timeline.js'

export const FRAME_RATES = [24, 30, 60] as const
export const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'none'] as const
export type Motion = (typeof MOTIONS)[number]
const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg']

export interface VideoLimits {
  maxSeconds: number
  maxScenes: number
  maxPixels: number
}

export type SceneSource = { svg: string } | { html: string } | { image: string; motion: Motion }

export type Scene = SceneSource & {
  seconds: number
  transition: TransitionKind
}

export interface VideoRequest {
  scenes: Scene[]
  width: number
  height: number
  fps: number
  timeline: Timeline
  /** File name of a soundtrack inside the output folder, if any. */
  audio?: string
  /** Fade in from black at the start and out to black at the end. */
  fade: boolean
  captions: Caption[]
  /** File name of an .srt to read captions from, if any. */
  subtitles?: string
  captionStyle: CaptionStyle
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T, label: string): T {
  if (value === undefined) return fallback
  if (!allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(', ')}.`)
  return value as T
}

function frameRate(value: unknown): number {
  if (value === undefined) return 30
  if (!FRAME_RATES.includes(value as (typeof FRAME_RATES)[number])) throw new Error(`fps must be one of ${FRAME_RATES.join(', ')}.`)
  return value as number
}

function checkSize(width: number, height: number, maxPixels: number) {
  for (const [label, value] of [['width', width], ['height', height]] as const) {
    if (!Number.isInteger(value) || value < 16 || value % 2 !== 0) throw new Error(`${label} must be an even whole number of pixels, at least 16.`)
  }
  if (width * height > maxPixels) throw new Error(`${width}×${height} is over the ${maxPixels}-pixel limit.`)
}

function sceneSource(raw: any, label: string): SceneSource {
  const given = ['svg', 'html', 'image'].filter((key) => typeof raw?.[key] === 'string' && raw[key].trim())
  if (given.length !== 1) throw new Error(`${label} needs exactly one of svg, html or image.`)
  if (given[0] === 'image') return { image: raw.image, motion: oneOf(raw.motion, MOTIONS, 'zoom-in', `${label}: motion`) }
  return given[0] === 'svg' ? { svg: raw.svg } : { html: raw.html }
}

function checkScene(raw: any, index: number, defaultTransition: TransitionKind): Scene {
  const label = `Scene ${index + 1}`
  const seconds = raw?.seconds ?? 3
  if (!(typeof seconds === 'number' && seconds >= 0.5 && seconds <= 60)) throw new Error(`${label}: seconds must be between 0.5 and 60.`)
  const transition = oneOf(raw?.transition, TRANSITIONS, defaultTransition, `${label}: transition`)
  return { ...sceneSource(raw, label), seconds, transition }
}

/** A bare file name with one of `extensions`; paths are refused. */
function checkFileName(name: unknown, extensions: string[], hint: string): string {
  const text = String(name ?? '')
  if (!text || basename(text) !== text || text.startsWith('.') || !extensions.includes(extname(text).toLowerCase())) throw new Error(hint)
  return text
}

/** A bare audio file name; paths are refused. */
export function checkAudioName(name: unknown): string {
  return checkFileName(name, AUDIO_EXTENSIONS, `audio must be the file name (no folders) of a ${AUDIO_EXTENSIONS.join(', ')} sound in the output folder, e.g. one saved by music_render.`)
}

export function parseVideoRequest(args: any, limits: VideoLimits): VideoRequest {
  const raw = Array.isArray(args.scenes) ? args.scenes : []
  if (!raw.length || raw.length > limits.maxScenes) throw new Error(`Give 1 to ${limits.maxScenes} scenes.`)
  const width = args.width ?? 1280
  const height = args.height ?? 720
  checkSize(width, height, limits.maxPixels)
  const fade = args.fade ?? true
  const defaultTransition = oneOf(args.transition, TRANSITIONS, fade ? 'fade' : 'cut', 'transition')
  const scenes = raw.map((scene: any, i: number) => checkScene(scene, i, defaultTransition))
  const timeline = planTimeline(scenes)
  if (timeline.total > limits.maxSeconds) throw new Error(`The video would be ${timeline.total} seconds long, over the ${limits.maxSeconds}-second limit.`)
  return {
    scenes, width, height, timeline, fade,
    fps: frameRate(args.fps),
    audio: args.audio === undefined ? undefined : checkAudioName(args.audio),
    captions: args.captions === undefined ? [] : checkCaptions(args.captions, timeline.total),
    subtitles: args.subtitles === undefined ? undefined : checkFileName(args.subtitles, ['.srt'], 'subtitles must be the file name (no folders) of an .srt file in the output folder, e.g. one saved by audio_transcribe.'),
    captionStyle: oneOf(args.captionStyle, CAPTION_STYLES, 'subtitle', 'captionStyle'),
  }
}
