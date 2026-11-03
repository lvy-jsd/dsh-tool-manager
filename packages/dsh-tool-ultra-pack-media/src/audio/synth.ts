/**
 * A tiny software synthesizer: renders a parsed score to mono PCM samples and
 * a WAV file, in plain TypeScript with no native code. It sounds simple
 * (oscillators and envelopes), which suits melodies, jingles and sketches;
 * the MIDI file from the same score plays with real instrument sounds.
 */
import type { DrumSound, Instrument, NoteEvent, Score } from './score.js'

export const SAMPLE_RATE = 22_050
const TAIL_SECONDS = 0.6
const RELEASE_SECONDS = 0.05

type Wave = (phase: number) => number
const WAVES: Record<Exclude<Instrument, 'drums'>, Wave> = {
  piano: (p) => Math.sin(p) + 0.4 * Math.sin(2 * p) + 0.15 * Math.sin(3 * p),
  chip: (p) => (Math.sin(p) >= 0 ? 0.6 : -0.6),
  flute: (p) => Math.sin(p) + 0.1 * Math.sin(2 * p),
  strings: (p) => 0.7 * (((p / Math.PI) % 2) - 1),
  bass: (p) => Math.sin(p) + 0.3 * Math.sin(2 * p),
}

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** Small deterministic noise source, so renders are reproducible. */
function noise(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) / 0xffffffff) * 2 - 1
  }
}

/** Attack / release envelope; the piano also decays while held. */
function envelope(t: number, length: number, instrument: Instrument): number {
  const attack = Math.min(1, t / 0.01)
  const release = t > length ? Math.max(0, 1 - (t - length) / RELEASE_SECONDS) : 1
  const decay = instrument === 'piano' || instrument === 'bass' ? Math.exp(-2.5 * t) : 1
  return attack * release * decay
}

function addTone(out: Float32Array, note: NoteEvent, seconds: { start: number; length: number }, instrument: Exclude<Instrument, 'drums'>, gain: number) {
  const first = Math.floor(seconds.start * SAMPLE_RATE)
  const count = Math.ceil((seconds.length + RELEASE_SECONDS) * SAMPLE_RATE)
  const scale = gain / Math.max(1, note.pitches.length)
  for (const pitch of note.pitches) {
    const step = (2 * Math.PI * midiToHz(pitch)) / SAMPLE_RATE
    for (let i = 0; i < count && first + i < out.length; i++) {
      out[first + i] += WAVES[instrument](i * step) * envelope(i / SAMPLE_RATE, seconds.length, instrument) * scale
    }
  }
}

function drumSample(drum: DrumSound, t: number, rand: () => number): number {
  if (drum === 'K') return Math.sin(2 * Math.PI * (50 * t + 100 * (1 - Math.exp(-20 * t)) / 20)) * Math.exp(-8 * t)
  if (drum === 'S') return (0.7 * rand() + 0.3 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-14 * t)
  return rand() * Math.exp(-45 * t) * 0.6
}

function addDrum(out: Float32Array, drum: DrumSound, start: number, gain: number, rand: () => number) {
  const first = Math.floor(start * SAMPLE_RATE)
  const count = Math.ceil(0.5 * SAMPLE_RATE)
  for (let i = 0; i < count && first + i < out.length; i++) out[first + i] += drumSample(drum, i / SAMPLE_RATE, rand) * gain
}

/** Peak-normalizes to 0.9 so quiet and dense pieces end up equally loud. */
function normalize(samples: Float32Array): Float32Array {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] *= 0.9 / peak
  return samples
}

export function renderScore(score: Score): Float32Array {
  const secondsPerBeat = 60 / score.tempo
  const out = new Float32Array(Math.ceil((score.beats * secondsPerBeat + TAIL_SECONDS) * SAMPLE_RATE))
  const rand = noise(12345)
  for (const track of score.tracks) {
    for (const note of track.events) {
      const start = note.start * secondsPerBeat
      if (note.drum) addDrum(out, note.drum, start, track.volume, rand)
      else if (track.instrument !== 'drums') addTone(out, note, { start, length: note.beats * secondsPerBeat }, track.instrument, track.volume)
    }
  }
  return normalize(out)
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
