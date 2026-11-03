/**
 * Standard MIDI File (format 1) encoder for a parsed score. A MIDI file plays
 * with real instrument sounds on phones and computers, so it is the
 * best-sounding output that needs no synthesizer on the server.
 */
import { drumKey, programOf } from './instruments.js'
import type { Score, Track } from './score.js'

const TICKS_PER_BEAT = 480
const DRUM_CHANNEL = 9
const CONTROL = { pan: 10, reverb: 91 } as const
/** A little room sound on every track, as a mix engineer would add. */
const REVERB_LEVEL = 40
/** Pan positions (0 left, 64 centre, 127 right) that spread tracks across the stereo field. */
const PAN_SPREAD = [64, 44, 84, 34, 94, 54, 74, 24, 104]

interface MidiEvent {
  tick: number
  bytes: number[]
}

function variableLength(value: number): number[] {
  const bytes = [value & 0x7f]
  for (let v = value >> 7; v > 0; v >>= 7) bytes.unshift((v & 0x7f) | 0x80)
  return bytes
}

function chunk(type: string, body: number[]): Buffer {
  const header = Buffer.alloc(8)
  header.write(type, 0, 'ascii')
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, Buffer.from(body)])
}

function tempoTrack(tempo: number): number[] {
  const microsPerBeat = Math.round(60_000_000 / tempo)
  return [0, 0xff, 0x51, 0x03, (microsPerBeat >> 16) & 0xff, (microsPerBeat >> 8) & 0xff, microsPerBeat & 0xff, 0, 0xff, 0x2f, 0x00]
}

function noteEvents(track: Track, channel: number): MidiEvent[] {
  const velocity = Math.max(1, Math.round(track.volume * 127))
  const events: MidiEvent[] = []
  for (const note of track.events) {
    const keys = note.drums ? note.drums.map(drumKey) : note.pitches
    const on = Math.round(note.start * TICKS_PER_BEAT)
    const off = Math.round((note.start + note.beats) * TICKS_PER_BEAT)
    for (const key of keys) {
      events.push({ tick: on, bytes: [0x90 | channel, key, velocity] })
      events.push({ tick: off, bytes: [0x80 | channel, key, 0] })
    }
  }
  // Note-offs sort before note-ons at the same tick, so repeated notes retrigger.
  return events.sort((a, b) => a.tick - b.tick || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0))
}

/** Program, pan and reverb at the start of a track; drums stay centred. */
function trackSetup(track: Track, channel: number, index: number): number[] {
  const reverb = [0, 0xb0 | channel, CONTROL.reverb, REVERB_LEVEL]
  if (track.instrument === 'drums') return reverb
  const pan = PAN_SPREAD[index % PAN_SPREAD.length]
  return [0, 0xc0 | channel, programOf(track.instrument), 0, 0xb0 | channel, CONTROL.pan, pan, ...reverb]
}

function trackBody(track: Track, channel: number, index: number): number[] {
  const body = trackSetup(track, channel, index)
  let last = 0
  for (const event of noteEvents(track, channel)) {
    body.push(...variableLength(event.tick - last), ...event.bytes)
    last = event.tick
  }
  return [...body, 0, 0xff, 0x2f, 0x00]
}

/** Channel per track: melodic tracks skip channel 10, drum tracks use it. */
function channelFor(track: Track, index: number): number {
  if (track.instrument === 'drums') return DRUM_CHANNEL
  return index >= DRUM_CHANNEL ? index + 1 : index
}

export function scoreToMidi(score: Score): Buffer {
  const header = [0, 1, 0, score.tracks.length + 1, TICKS_PER_BEAT >> 8, TICKS_PER_BEAT & 0xff]
  const tracks = score.tracks.map((track, i) => chunk('MTrk', trackBody(track, channelFor(track, i), i)))
  return Buffer.concat([chunk('MThd', header), chunk('MTrk', tempoTrack(score.tempo)), ...tracks])
}
