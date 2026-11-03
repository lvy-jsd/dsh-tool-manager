/**
 * Renders a checked video request: SVG scenes become PNG frames, then the
 * host's ffmpeg joins them (and an optional soundtrack) into an MP4.
 *
 * ffmpeg runs as a separate program with an argument list (no shell), a
 * timeout, and inputs that are either our own temporary frames or a file
 * inside the output folder.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import sharp from 'sharp'
import { rasterizeSvg, type RasterLimits } from '../svg.js'
import { ffmpegArgs, type VideoRequest } from './scenes.js'

export interface VideoRuntime {
  outputDir: string
  ffmpegPath: string
  timeoutMs: number
  svgLimits: RasterLimits
}

export type RunProgram = (file: string, args: string[], timeoutMs: number) => Promise<void>

/** Runs a program without a shell; a missing ffmpeg gets a plain-language error. */
export const runProgram: RunProgram = (file, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
    if (!error) return resolve()
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error(`video_render needs ffmpeg on the server, and "${file}" was not found. Install ffmpeg or set ffmpegPath.`))
    if (error.killed) return reject(new Error(`ffmpeg took longer than ${timeoutMs / 1000} seconds and was stopped.`))
    reject(new Error(`ffmpeg failed: ${String(stderr).trim().slice(0, 500) || error.message}`))
  })
})

/** Absolute path of a file inside the output folder; anything that resolves elsewhere is refused. */
export async function resolveOutputFile(outputDir: string, name: string): Promise<string> {
  const root = await realpath(outputDir)
  let path: string
  try {
    path = await realpath(join(root, name))
  } catch {
    throw new Error(`No file named "${name}" in the output folder. Make the soundtrack with music_render first.`)
  }
  if (!path.startsWith(root + sep)) throw new Error(`"${name}" is not inside the output folder.`)
  return path
}

async function renderFrame(svg: string, request: VideoRequest, limits: RasterLimits): Promise<Buffer> {
  const raster = await rasterizeSvg(svg, { format: 'png', width: request.width }, limits)
  return sharp(raster.data)
    .resize(request.width, request.height, { fit: 'contain', background: '#000000' })
    .png()
    .toBuffer()
}

async function writeFrames(request: VideoRequest, dir: string, limits: RasterLimits): Promise<string[]> {
  const paths: string[] = []
  for (const [i, scene] of request.scenes.entries()) {
    const path = join(dir, `scene-${i}.png`)
    await writeFile(path, await renderFrame(scene.svg, request, limits))
    paths.push(path)
  }
  return paths
}

/** Renders the video into a temporary folder and returns the MP4 bytes. */
export async function renderVideo(request: VideoRequest, runtime: VideoRuntime, run: RunProgram = runProgram): Promise<Buffer> {
  const audioPath = request.audio ? await resolveOutputFile(runtime.outputDir, request.audio) : undefined
  const dir = await mkdtemp(join(tmpdir(), 'dsh-media-video-'))
  try {
    const frames = await writeFrames(request, dir, runtime.svgLimits)
    const outPath = join(dir, 'video.mp4')
    await run(runtime.ffmpegPath, ffmpegArgs(request, frames, audioPath, outPath), runtime.timeoutMs)
    return await readFile(outPath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
