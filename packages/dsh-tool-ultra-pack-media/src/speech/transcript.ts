/** Transcript formatting: timestamped text for the model, SRT subtitles for people. */

export interface Segment {
  start: number
  end: number
  text: string
  /** 1, 2, … when more than one person speaks. */
  speaker?: number
  /** How the speaker sounds, when not neutral: happy, sad, angry, … */
  emotion?: string
  /** A sound heard with or instead of speech: music, laughter, applause, … */
  sound?: string
}

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

/** A time label that stays distinct for short clips: "3.5 s" under a minute, else clock(). */
export function shortTime(seconds: number, total: number): string {
  return total < 60 ? `${(Math.round(seconds * 10) / 10).toFixed(1)} s` : clock(seconds)
}

function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

const speakerLabel = (s: Segment) => (s.speaker ? `Speaker ${s.speaker}` : '')

/** Subtitles: "Speaker 1: text", with a sound in brackets when there are no words. */
export function toSrt(segments: Segment[]): string {
  const line = (s: Segment) => [speakerLabel(s), s.text || `[${s.sound}]`].filter(Boolean).join(': ')
  return segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${line(s)}\n`).join('\n')
}

/** "Speaker 2 (happy, laughter): text" for the model. */
function describe(s: Segment): string {
  const notes = [s.emotion, s.sound].filter(Boolean).join(', ')
  const who = [speakerLabel(s), notes && `(${notes})`].filter(Boolean).join(' ')
  if (!s.text) return who
  return who ? `${who}: ${s.text}` : s.text
}

/** "[00:00-00:05] text" lines, cut at `maxChars` with a note. */
export function timestampedText(segments: Segment[], maxChars: number): string {
  const full = segments.map((s) => `[${clock(s.start)}-${clock(s.end)}] ${describe(s)}`).join('\n')
  if (full.length <= maxChars) return full
  return `${full.slice(0, maxChars)}\n[truncated: ${full.length - maxChars} more characters are in the SRT file]`
}
