/**
 * Renders a checked video request: SVG scenes become PNG frames, then the
 * host's ffmpeg joins them (and an optional soundtrack) into an MP4.
 *
 * ffmpeg runs as a separate program with an argument list (no shell), a
 * timeout, and inputs that are either our own temporary frames or a file
 * inside the output folder.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { runProgram, type RunProgram } from '../ffmpeg.js'
import { resolveOutputFile } from '../files.js'
import { rasterizeSvg, type RasterLimits } from '../svg.js'
import { ffmpegArgs, type VideoRequest } from './scenes.js'

export interface VideoRuntime {
  outputDir: string
  ffmpegPath: string
  timeoutMs: number
  svgLimits: RasterLimits
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
