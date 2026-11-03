/**
 * Plays a MIDI file through a SoundFont with spessasynth_core (Apache-2.0):
 * a full SoundFont 2/3 synthesizer in TypeScript, with reverb and chorus,
 * rendering offline far faster than real time.
 */
import type { Audio } from './master.js'

export const SAMPLER_RATE = 44_100
/** Room for the last notes and the reverb to ring out. */
const TAIL_SECONDS = 1.5
const BLOCK = 128

type Spessa = typeof import('spessasynth_core')
type SoundBank = ReturnType<Spessa['SoundBankLoader']['fromArrayBuffer']>

let spessa: Promise<Spessa> | undefined
const banks = new WeakMap<Buffer, SoundBank>()

async function library(): Promise<Spessa> {
  spessa ??= import('spessasynth_core').then((lib) => {
    lib.SpessaLog.setLogLevel(false, false, false)
    return lib
  })
  return spessa
}

function arrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Renders `midi` with the SoundFont in `soundFont` to stereo audio. */
export async function renderMidi(midi: Buffer, soundFont: Buffer): Promise<Audio> {
  const lib = await library()
  let bank = banks.get(soundFont)
  if (!bank) banks.set(soundFont, (bank = lib.SoundBankLoader.fromArrayBuffer(arrayBuffer(soundFont))))
  const synth = new lib.SpessaSynthProcessor(SAMPLER_RATE, { eventsEnabled: false, effectsEnabled: true })
  synth.soundBankManager.addSoundBank(bank, 'main')
  await synth.ready
  const sequencer = new lib.SpessaSynthSequencer(synth)
  sequencer.loadNewSongList([lib.BasicMIDI.fromArrayBuffer(arrayBuffer(midi))])
  sequencer.play()
  const frames = Math.ceil((sequencer.duration + TAIL_SECONDS) * SAMPLER_RATE)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let i = 0; i < frames; i += BLOCK) {
    sequencer.processTick()
    synth.process(left, right, i, Math.min(BLOCK, frames - i))
  }
  return { channels: [left, right], sampleRate: SAMPLER_RATE }
}
