/** Transcript formatting: timestamped text for the model, SRT subtitles for people. */
import type { Segment } from './whisper.js'

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** 75.5 → "01:15" (or "1:01:15" past an hour). */
export function clock(seconds: number): string {
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(whole % 60)}` : `${pad(m)}:${pad(whole % 60)}`
}

function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

export function toSrt(segments: Segment[]): string {
  return segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join('\n')
}

/** "[00:00-00:05] text" lines, cut at `maxChars` with a note. */
export function timestampedText(segments: Segment[], maxChars: number): string {
  const full = segments.map((s) => `[${clock(s.start)}-${clock(s.end)}] ${s.text}`).join('\n')
  if (full.length <= maxChars) return full
  return `${full.slice(0, maxChars)}\n[truncated: ${full.length - maxChars} more characters are in the SRT file]`
}
