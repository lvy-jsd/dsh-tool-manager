/**
 * The instruments and drum sounds a score can use: the General MIDI program
 * (or drum key) each one plays with a SoundFont, and the built-in synth voice
 * that stands in for it when no SoundFont is available.
 */

/** Voices of the built-in synth (see synth.ts). */
export type SynthVoice = 'piano' | 'chip' | 'flute' | 'strings' | 'bass'

const MELODIC = {
  piano: { program: 0, voice: 'piano' },
  'electric-piano': { program: 4, voice: 'piano' },
  harpsichord: { program: 6, voice: 'piano' },
  'music-box': { program: 10, voice: 'piano' },
  vibraphone: { program: 11, voice: 'piano' },
  marimba: { program: 12, voice: 'piano' },
  organ: { program: 19, voice: 'strings' },
  accordion: { program: 21, voice: 'strings' },
  guitar: { program: 24, voice: 'piano' },
  'steel-guitar': { program: 25, voice: 'piano' },
  'electric-guitar': { program: 27, voice: 'piano' },
  'rock-guitar': { program: 30, voice: 'strings' },
  bass: { program: 33, voice: 'bass' },
  'acoustic-bass': { program: 32, voice: 'bass' },
  'synth-bass': { program: 38, voice: 'bass' },
  violin: { program: 40, voice: 'strings' },
  cello: { program: 42, voice: 'strings' },
  pizzicato: { program: 45, voice: 'piano' },
  harp: { program: 46, voice: 'piano' },
  timpani: { program: 47, voice: 'bass' },
  strings: { program: 48, voice: 'strings' },
  choir: { program: 52, voice: 'flute' },
  trumpet: { program: 56, voice: 'flute' },
  trombone: { program: 57, voice: 'flute' },
  horn: { program: 60, voice: 'flute' },
  brass: { program: 61, voice: 'strings' },
  sax: { program: 65, voice: 'flute' },
  oboe: { program: 68, voice: 'flute' },
  clarinet: { program: 71, voice: 'flute' },
  flute: { program: 73, voice: 'flute' },
  'pan-flute': { program: 75, voice: 'flute' },
  chip: { program: 80, voice: 'chip' },
  'synth-lead': { program: 81, voice: 'chip' },
  pad: { program: 89, voice: 'strings' },
  sitar: { program: 104, voice: 'piano' },
  koto: { program: 107, voice: 'piano' },
  'steel-drums': { program: 114, voice: 'piano' },
} as const satisfies Record<string, { program: number; voice: SynthVoice }>

export type MelodicInstrument = keyof typeof MELODIC
export const INSTRUMENTS = [...(Object.keys(MELODIC) as MelodicInstrument[]), 'drums'] as const
export type Instrument = MelodicInstrument | 'drums'

/** Drum sounds by letter: their General MIDI key, and which synth drum stands in. */
const DRUMS = {
  K: { key: 36, synth: 'kick', name: 'kick' },
  S: { key: 38, synth: 'snare', name: 'snare' },
  P: { key: 39, synth: 'snare', name: 'clap' },
  H: { key: 42, synth: 'hat', name: 'closed hi-hat' },
  O: { key: 46, synth: 'hat', name: 'open hi-hat' },
  C: { key: 49, synth: 'hat', name: 'crash' },
  Y: { key: 51, synth: 'hat', name: 'ride' },
  T: { key: 50, synth: 'kick', name: 'high tom' },
  M: { key: 47, synth: 'kick', name: 'mid tom' },
  L: { key: 45, synth: 'kick', name: 'low tom' },
} as const

export type DrumSound = keyof typeof DRUMS
export type SynthDrum = (typeof DRUMS)[DrumSound]['synth']
export const DRUM_SOUNDS = Object.keys(DRUMS) as DrumSound[]
export const DRUM_HELP = DRUM_SOUNDS.map((d) => `${d} ${DRUMS[d].name}`).join(', ')

export const programOf = (instrument: MelodicInstrument): number => MELODIC[instrument].program
export const voiceOf = (instrument: MelodicInstrument): SynthVoice => MELODIC[instrument].voice
export const drumKey = (drum: DrumSound): number => DRUMS[drum].key
export const synthDrum = (drum: DrumSound): SynthDrum => DRUMS[drum].synth
