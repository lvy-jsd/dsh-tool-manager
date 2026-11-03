/** video_understand: a video's facts, a storyboard image and the spoken words, all made on this server. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProgram } from '../ffmpeg.js'
import { resolveInputFile } from '../files.js'
import { safeBaseName, saveFile } from '../output.js'
import { NAME_PARAMETER, type Settings, type ToolSpec } from '../settings.js'
import { clock, shortTime, timestampedText } from '../speech/transcript.js'
import { parseProbe, probeArgs, type MediaInfo } from '../video/probe.js'
import { buildStoryboard, cutArgs, extractArgs, listFrames, parseCuts, planFrames, type FramePlan } from '../video/storyboard.js'
import { modelTitle } from '../speech/engine.js'
import { createSpeechReader, describeSpeakers, languageOf, type TranscribeDeps } from './transcribe.js'

const FRAMES = { min: 4, max: 16, default: 12 }

function frameCount(value: unknown): number {
  if (value === undefined) return FRAMES.default
  if (!Number.isInteger(value) || (value as number) < FRAMES.min || (value as number) > FRAMES.max) {
    throw new Error(`frames must be a whole number from ${FRAMES.min} to ${FRAMES.max}.`)
  }
  return value as number
}

function describeMedia(path: string, info: MediaInfo): string {
  const picture = info.video ? `${info.video.width}×${info.video.height}, ${info.video.fps} fps` : 'no picture'
  return `File ${path}: ${clock(info.duration)} long, ${picture}, ${info.hasAudio ? 'with sound' : 'no sound'}.`
}

export function understandTool(settings: Settings, deps: TranscribeDeps = {}): ToolSpec {
  const run = deps.run ?? runProgram
  const readSpeech = createSpeechReader(settings, deps)
  const timeoutMs = settings.ffmpegTimeoutMs

  /** Where the frames go: following the cuts when ffmpeg finds any, else evenly. */
  async function plan(path: string, info: MediaInfo, count: number): Promise<FramePlan> {
    const printed = await run(settings.ffmpegPath, cutArgs(path), timeoutMs)
    return planFrames(info.duration, parseCuts(printed), count)
  }

  function describeCuts(cuts: number[], duration: number): string {
    if (!cuts.length) return 'No scene changes found; frames are evenly spaced.'
    return `${cuts.length + 1} shots; the scene changes at ${cuts.map((t) => shortTime(t, duration)).join(', ')}.`
  }

  async function storyboard(path: string, info: MediaInfo, count: number, name: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-media-frames-'))
    try {
      const { times, cuts } = await plan(path, info, count)
      await run(settings.ffmpegPath, extractArgs(path, dir, times), timeoutMs)
      const frames = await listFrames(dir)
      if (!frames.length) return 'Storyboard: no frames could be read from the picture.'
      const image = await buildStoryboard(frames, times.map((t) => shortTime(t, info.duration)))
      const saved = await saveFile(settings.outputDir, name, 'jpg', image)
      return `${describeCuts(cuts, info.duration)}\nStoryboard (${frames.length} frames, at least one per shot, left to right then top to bottom, each labelled with its time): ${saved}\n`
        + 'To see what happens on screen, look at this image with your image-reading tool.'
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async function transcript(path: string, language: string | undefined): Promise<string> {
    const { segments } = await readSpeech(path, { language })
    if (!segments.length) return 'Speech: none found.'
    const about = `${modelTitle(settings.speech, language)}, ${describeSpeakers(segments)}, ${segments.length} segments`
    return `Speech (${about}):\n${timestampedText(segments, settings.speech.maxChars)}`
  }

  async function understand(args: any): Promise<string> {
    const path = await resolveInputFile(settings, String(args.file ?? ''))
    const count = frameCount(args.frames)
    const language = languageOf(args.language)
    const info = parseProbe(await run(settings.ffprobePath, probeArgs(path), timeoutMs))
    const name = safeBaseName(args.name, 'storyboard')
    const parts = [describeMedia(path, info)]
    if (info.video) parts.push(await storyboard(path, info, count, name))
    if (info.hasAudio && args.transcript !== false) parts.push(await transcript(path, language))
    return parts.join('\n\n')
  }

  return {
    name: 'video_understand',
    description: 'Understand a video (or audio) file on this server, with nothing uploaded: its length and size, a storyboard image of key frames '
      + 'that follow the scene changes, with timestamps, and a timestamped transcript of the speech with who speaks when (local models). Look at the storyboard image to see the scenes.',
    parameters: {
      file: { type: 'string', required: true, description: 'A file name from the output folder, or an absolute path inside an allowed input folder.' },
      frames: { type: 'integer', description: `Frames on the storyboard, ${FRAMES.min}-${FRAMES.max}. Default ${FRAMES.default}.` },
      transcript: { type: 'boolean', description: 'Transcribe the speech too. Default true; false is faster.' },
      language: { type: 'string', description: 'Spoken language code such as "zh" or "en". Default: detect.' },
      name: NAME_PARAMETER,
    },
    execute: understand,
  }
}
