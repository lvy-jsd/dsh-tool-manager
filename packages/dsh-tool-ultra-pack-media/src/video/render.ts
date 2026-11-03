/**
 * Renders a checked video request frame by frame: each frame is drawn from
 * the scene (or two scenes mid-transition) showing at that moment, with its
 * caption laid over it and the opening and closing fades applied, then
 * streamed as raw pixels into the host's ffmpeg, which encodes H.264 and
 * adds the soundtrack.
 *
 * ffmpeg runs as a separate program with an argument list (no shell), a time
 * limit, and inputs that are our own frames or files inside the allowed folders.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { feedProgram, type FeedProgram } from '../ffmpeg.js'
import { resolveInputFile, resolveOutputFile, type InputFolders } from '../files.js'
import type { HtmlRenderer, Page } from '../html/render.js'
import type { RasterLimits } from '../svg.js'
import { captionPage, isShowing, parseSrt, type Caption } from './captions.js'
import { dim, overlay, transition, type FrameSize } from './compose.js'
import { sceneFrames, type SceneFrames } from './layers.js'
import type { VideoRequest } from './scenes.js'
import { frameAt } from './timeline.js'

/** Length of the fade in from black and out to black. */
const FADE_SECONDS = 0.4

export interface VideoRuntime {
  folders: InputFolders
  ffmpegPath: string
  timeoutMs: number
  svgLimits: RasterLimits
  renderer: HtmlRenderer
  feed?: FeedProgram
}

/** ffmpeg arguments: raw RGBA frames on standard input (and a soundtrack) → H.264/AAC MP4. */
export function encodeArgs(request: VideoRequest, audioPath: string | undefined, outPath: string): string[] {
  const video = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${request.width}x${request.height}`, '-framerate', String(request.fps), '-i', 'pipe:0']
  const audioInput = audioPath ? ['-i', audioPath] : []
  const audioOutput = audioPath ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '160k'] : []
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    ...video, ...audioInput,
    '-map', '0:v', ...audioOutput,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-t', String(request.timeline.total), '-movflags', '+faststart',
    outPath,
  ]
}

/** How bright the frame at `t` is: 0 → 1 over the opening fade, 1 → 0 over the closing one. */
export function fadeLevel(t: number, total: number, fade: boolean): number {
  if (!fade) return 1
  return Math.min(1, t / FADE_SECONDS, (total - t) / FADE_SECONDS)
}

async function allCaptions(request: VideoRequest, folders: InputFolders): Promise<Caption[]> {
  if (!request.subtitles) return request.captions
  const srt = parseSrt(await readFile(await resolveInputFile(folders, request.subtitles), 'utf8'))
  return [...request.captions, ...srt.filter((c) => c.start < request.timeline.total)]
}

/** Yields `count` results of `make(i)` in order, working on up to `ahead` at once. */
async function* inOrder<T>(count: number, make: (i: number) => Promise<T>, ahead: number): AsyncGenerator<T> {
  const pending: Promise<T>[] = []
  for (let i = 0; i < count; i++) {
    const next = make(i)
    next.catch(() => {}) // Awaited in turn below; this only keeps an early failure from being reported twice.
    pending.push(next)
    if (pending.length > ahead) yield await pending.shift()!
  }
  while (pending.length) yield await pending.shift()!
}

function frameDrawer(request: VideoRequest, scenes: SceneFrames[], captions: { caption: Caption; page: Page }[], renderer: HtmlRenderer) {
  const size: FrameSize = { width: request.width, height: request.height }
  const box = { ...size, scale: 1 }

  async function base(t: number): Promise<Buffer> {
    const frame = frameAt(request.timeline, t)
    if ('scene' in frame) return scenes[frame.scene](frame.local)
    const [a, b] = await Promise.all([scenes[frame.from.scene](frame.from.local), scenes[frame.to.scene](frame.to.local)])
    return transition(a, b, size, frame.kind, frame.progress)
  }

  return async (t: number): Promise<Buffer> => {
    let frame = await base(t)
    const active = captions.find(({ caption }) => isShowing(caption, t))
    if (active) frame = overlay(frame, (await renderer.still(active.page, box, 'raw', (t - active.caption.start) * 1000)).data)
    return dim(frame, fadeLevel(t, request.timeline.total, request.fade))
  }
}

/** Renders the video into a temporary folder and returns the MP4 bytes. */
export async function renderVideo(request: VideoRequest, runtime: VideoRuntime): Promise<Buffer> {
  const { folders, renderer } = runtime
  const audioPath = request.audio ? await resolveOutputFile(folders.outputDir, request.audio) : undefined
  const size = { width: request.width, height: request.height }
  const scenes = await Promise.all(request.scenes.map((scene) => sceneFrames(scene, size, renderer, runtime.svgLimits)))
  const captions = await Promise.all((await allCaptions(request, folders)).map(async (caption) => ({ caption, page: await renderer.open(captionPage(caption, request.captionStyle, request.height)) })))
  const draw = frameDrawer(request, scenes, captions, renderer)
  const count = Math.round(request.timeline.total * request.fps)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-media-video-'))
  try {
    const outPath = join(dir, 'video.mp4')
    const frames = inOrder(count, (i) => draw(i / request.fps), availableParallelism())
    await (runtime.feed ?? feedProgram)(runtime.ffmpegPath, encodeArgs(request, audioPath, outPath), frames, runtime.timeoutMs)
    return await readFile(outPath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
