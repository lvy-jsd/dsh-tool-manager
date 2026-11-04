/** What a media file contains, read with ffprobe. */
import { clock } from '../speech/transcript.js'

export interface MediaInfo {
  /** Seconds. */
  duration: number
  /** Present when the file has a picture stream. */
  video?: { width: number; height: number; fps: number }
  hasAudio: boolean
}

export function describeMedia(path: string, info: MediaInfo): string {
  const picture = info.video ? `${info.video.width}×${info.video.height}, ${info.video.fps} fps` : 'no picture'
  return `File ${path}: ${clock(info.duration)} long, ${picture}, ${info.hasAudio ? 'with sound' : 'no sound'}.`
}

export function probeArgs(file: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file]
}

/** "30000/1001" → 29.97. */
function frameRate(value: unknown): number {
  const [top, bottom = '1'] = String(value ?? '0').split('/')
  const rate = Number(top) / Number(bottom)
  return Number.isFinite(rate) ? Math.round(rate * 100) / 100 : 0
}

export function parseProbe(json: string): MediaInfo {
  const data = JSON.parse(json)
  const streams: any[] = data.streams ?? []
  const picture = streams.find((s) => s.codec_type === 'video' && s.width && s.height)
  const duration = Number(data.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read the length of this file; it may not be audio or video.')
  return {
    duration,
    video: picture ? { width: picture.width, height: picture.height, fps: frameRate(picture.avg_frame_rate) } : undefined,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  }
}
