/**
 * A tiny software synthesizer: renders a parsed score to mono samples in
 * plain TypeScript with no native code. It sounds simple (oscillators and
 * envelopes); it stands in when no SoundFont can be loaded.
 */
import { synthDrum, voiceOf, type SynthDrum, type SynthVoice } from './instruments.js'
import type { Audio } from './master.js'
import type { NoteEvent, Score } from './score.js'

export const SAMPLE_RATE = 22_050
const TAIL_SECONDS = 0.6
const RELEASE_SECONDS = 0.05

type Wave = (phase: number) => number
const WAVES: Record<SynthVoice, Wave> = {
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
function envelope(t: number, length: number, voice: SynthVoice): number {
  const attack = Math.min(1, t / 0.01)
  const release = t > length ? Math.max(0, 1 - (t - length) / RELEASE_SECONDS) : 1
  const decay = voice === 'piano' || voice === 'bass' ? Math.exp(-2.5 * t) : 1
  return attack * release * decay
}

function addTone(out: Float32Array, note: NoteEvent, seconds: { start: number; length: number }, voice: SynthVoice, gain: number) {
  const first = Math.floor(seconds.start * SAMPLE_RATE)
  const count = Math.ceil((seconds.length + RELEASE_SECONDS) * SAMPLE_RATE)
  const scale = gain / Math.max(1, note.pitches.length)
  for (const pitch of note.pitches) {
    const step = (2 * Math.PI * midiToHz(pitch)) / SAMPLE_RATE
    for (let i = 0; i < count && first + i < out.length; i++) {
      out[first + i] += WAVES[voice](i * step) * envelope(i / SAMPLE_RATE, seconds.length, voice) * scale
    }
  }
}

function drumSample(drum: SynthDrum, t: number, rand: () => number): number {
  if (drum === 'kick') return Math.sin(2 * Math.PI * (50 * t + 100 * (1 - Math.exp(-20 * t)) / 20)) * Math.exp(-8 * t)
  if (drum === 'snare') return (0.7 * rand() + 0.3 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-14 * t)
  return rand() * Math.exp(-45 * t) * 0.6
}

function addDrum(out: Float32Array, drum: SynthDrum, start: number, gain: number, rand: () => number) {
  const first = Math.floor(start * SAMPLE_RATE)
  const count = Math.ceil(0.5 * SAMPLE_RATE)
  for (let i = 0; i < count && first + i < out.length; i++) out[first + i] += drumSample(drum, i / SAMPLE_RATE, rand) * gain
}

/** The score as mono audio from the built-in synth, before mastering. */
export function renderScore(score: Score): Audio {
  const secondsPerBeat = 60 / score.tempo
  const out = new Float32Array(Math.ceil((score.beats * secondsPerBeat + TAIL_SECONDS) * SAMPLE_RATE))
  const rand = noise(12345)
  for (const track of score.tracks) {
    for (const note of track.events) {
      const start = note.start * secondsPerBeat
      if (track.instrument === 'drums') for (const drum of note.drums ?? []) addDrum(out, synthDrum(drum), start, track.volume, rand)
      else addTone(out, note, { start, length: note.beats * secondsPerBeat }, voiceOf(track.instrument), track.volume)
    }
  }
  return { channels: [out], sampleRate: SAMPLE_RATE }
}
