/**
 * A small score format the model can write by hand.
 *
 * Each track is a line of `<sound>:<beats>` tokens played one after another:
 *
 *   "C4:1 E4:1 G4:2 R:1 [C4,E4,G4]:2"   (notes, a rest, a chord)
 *   "K:1 H:0.5 H:0.5 S:1 H:1"           (drums: K kick, S snare, H hi-hat)
 *
 * Beats may be decimals or fractions ("1/2"). The score is validated against
 * fixed limits before anything is rendered.
 */

export const INSTRUMENTS = ['piano', 'chip', 'flute', 'strings', 'bass', 'drums'] as const
export type Instrument = (typeof INSTRUMENTS)[number]
export const DRUM_SOUNDS = ['K', 'S', 'H'] as const
export type DrumSound = (typeof DRUM_SOUNDS)[number]

export interface ScoreInput {
  tempo?: number
  tracks?: Array<{ instrument?: string; notes?: string; volume?: number }>
}

/** One sounding event; `pitches` are MIDI numbers, or a drum sound on a drum track. */
export interface NoteEvent {
  start: number
  beats: number
  pitches: number[]
  drum?: DrumSound
}

export interface Track {
  instrument: Instrument
  volume: number
  events: NoteEvent[]
}

export interface Score {
  tempo: number
  tracks: Track[]
  /** Length of the longest track, in beats. */
  beats: number
}

export interface ScoreLimits {
  maxSeconds: number
  maxEvents: number
}

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const PITCH = /^([A-G])([#b]?)(-?\d)$/
const TOKEN = /^(.+):([\d./]+)$/

/** MIDI number for a pitch name such as "C4", "F#3" or "Bb2". */
export function pitchToMidi(name: string): number {
  const match = PITCH.exec(name)
  if (!match) throw new Error(`"${name}" is not a pitch: use a letter A-G, an optional # or b, and an octave, e.g. C4 or F#3.`)
  const [, letter, accidental, octave] = match
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  const midi = 12 * (Number(octave) + 1) + SEMITONES[letter] + shift
  if (midi < 0 || midi > 127) throw new Error(`Pitch ${name} is out of range.`)
  return midi
}

function parseBeats(text: string, token: string): number {
  const [top, bottom = '1'] = text.split('/')
  const beats = Number(top) / Number(bottom)
  if (!Number.isFinite(beats) || beats <= 0 || beats > 64) throw new Error(`"${token}": beats must be a number above 0 and at most 64.`)
  return beats
}

function parseSound(sound: string, instrument: Instrument): Pick<NoteEvent, 'pitches' | 'drum'> {
  if (sound === 'R') return { pitches: [] }
  if (instrument === 'drums') {
    if (!DRUM_SOUNDS.includes(sound as DrumSound)) throw new Error(`Drum tracks use K (kick), S (snare), H (hi-hat) or R (rest), not "${sound}".`)
    return { pitches: [], drum: sound as DrumSound }
  }
  const chord = /^\[(.+)\]$/.exec(sound)
  const names = chord ? chord[1].split(',').map((s) => s.trim()) : [sound]
  return { pitches: names.map(pitchToMidi) }
}

/** Parses one track line into timed events, starting at beat 0. */
export function parseTrackNotes(notes: string, instrument: Instrument): NoteEvent[] {
  const events: NoteEvent[] = []
  let start = 0
  for (const token of notes.trim().split(/\s+/).filter(Boolean)) {
    const match = TOKEN.exec(token)
    if (!match) throw new Error(`"${token}" should look like C4:1, [C4,E4]:2 or R:1.`)
    const beats = parseBeats(match[2], token)
    events.push({ start, beats, ...parseSound(match[1], instrument) })
    start += beats
  }
  return events
}

function parseTrack(raw: NonNullable<ScoreInput['tracks']>[number]): Track {
  const instrument = (raw.instrument ?? 'piano') as Instrument
  if (!INSTRUMENTS.includes(instrument)) throw new Error(`instrument must be one of ${INSTRUMENTS.join(', ')}.`)
  const volume = raw.volume ?? 0.8
  if (!(volume >= 0 && volume <= 1)) throw new Error('volume must be between 0 and 1.')
  if (typeof raw.notes !== 'string' || !raw.notes.trim()) throw new Error('Each track needs notes, e.g. "C4:1 E4:1 G4:2".')
  return { instrument, volume, events: parseTrackNotes(raw.notes, instrument) }
}

function trackBeats(track: Track): number {
  const last = track.events.at(-1)
  return last ? last.start + last.beats : 0
}

/** Parses and checks a whole score. */
export function parseScore(input: ScoreInput, limits: ScoreLimits): Score {
  const tempo = input.tempo ?? 100
  if (!(tempo >= 20 && tempo <= 300)) throw new Error('tempo must be between 20 and 300 beats per minute.')
  if (!Array.isArray(input.tracks) || !input.tracks.length || input.tracks.length > 16) throw new Error('Give 1 to 16 tracks.')
  const tracks = input.tracks.map(parseTrack)
  const beats = Math.max(...tracks.map(trackBeats))
  const seconds = (beats * 60) / tempo
  if (seconds > limits.maxSeconds) throw new Error(`The piece is ${Math.round(seconds)} seconds long, over the ${limits.maxSeconds}-second limit.`)
  const events = tracks.reduce((sum, t) => sum + t.events.length, 0)
  if (events > limits.maxEvents) throw new Error(`The piece has ${events} notes, over the ${limits.maxEvents}-note limit.`)
  return { tempo, tracks, beats }
}
