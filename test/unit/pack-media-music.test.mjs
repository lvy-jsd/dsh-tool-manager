// Media pack, music: the note notation, limits, the MIDI encoder and the built-in synthesizer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTools, encodeWav, parseScore, pitchToMidi, renderScore, scoreToMidi } from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

const LIMITS = { maxSeconds: 300, maxEvents: 5000 }
const score = (tracks, tempo = 120) => parseScore({ tempo, tracks }, LIMITS)

/** Frequency estimate from upward zero crossings over a window of samples. */
function frequency(samples, from, to, rate = 22_050) {
  let crossings = 0
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++
  return crossings / ((to - from) / rate)
}

test('music: pitch names map to MIDI numbers', () => {
  assert.equal(pitchToMidi('C4'), 60)
  assert.equal(pitchToMidi('A4'), 69)
  assert.equal(pitchToMidi('F#3'), 54)
  assert.equal(pitchToMidi('Bb2'), 46)
  assert.throws(() => pitchToMidi('H4'), /not a pitch/)
  assert.throws(() => pitchToMidi('Cb-1'), /out of range/)
})

test('music: tracks parse into timed notes, rests, chords and drums', () => {
  const s = score([
    { notes: 'C4:1 R:1/2 [C4,E4,G4]:1.5' },
    { instrument: 'drums', notes: 'K:1 S:1 H:0.5' },
  ])
  assert.deepEqual(s.tracks[0].events, [
    { start: 0, beats: 1, pitches: [60] },
    { start: 1, beats: 0.5, pitches: [] },
    { start: 1.5, beats: 1.5, pitches: [60, 64, 67] },
  ])
  assert.deepEqual(s.tracks[1].events.map((e) => e.drum), ['K', 'S', 'H'])
  assert.equal(s.beats, 3)
})

test('music: bad scores fail with readable reasons', () => {
  assert.throws(() => score([{ notes: 'C4' }]), /should look like C4:1/)
  assert.throws(() => score([{ notes: 'C4:0' }]), /beats must be a number above 0/)
  assert.throws(() => score([{ instrument: 'drums', notes: 'C4:1' }]), /Drum tracks use K/)
  assert.throws(() => score([{ instrument: 'kazoo', notes: 'C4:1' }]), /instrument must be one of/)
  assert.throws(() => score([{ notes: 'C4:1', volume: 3 }]), /volume must be between 0 and 1/)
  assert.throws(() => score([]), /Give 1 to 16 tracks/)
  assert.throws(() => score([{ notes: 'C4:1' }], 500), /tempo must be between/)
  assert.throws(() => parseScore({ tempo: 60, tracks: [{ notes: 'C4:64 C4:64' }] }, { maxSeconds: 100, maxEvents: 10 }), /over the 100-second limit/)
  assert.throws(() => parseScore({ tracks: [{ notes: 'C4:1 '.repeat(11) }] }, { maxSeconds: 300, maxEvents: 10 }), /11 notes, over the 10-note limit/)
})

test('music: MIDI has a header, a tempo track and one track per score track', () => {
  const midi = scoreToMidi(score([{ instrument: 'flute', notes: 'A4:1' }, { instrument: 'drums', notes: 'K:1' }]))
  assert.equal(midi.subarray(0, 4).toString('ascii'), 'MThd')
  assert.equal(midi.readUInt16BE(8), 1) // format 1
  assert.equal(midi.readUInt16BE(10), 3) // tempo track + 2
  assert.equal(midi.readUInt16BE(12), 480) // ticks per beat
  const hex = midi.toString('hex')
  assert.ok(hex.includes('ff5103' + (500000).toString(16).padStart(6, '0')), '120 bpm tempo')
  assert.ok(hex.includes('00c049' + '00904566'), 'flute program 73, then A4 note-on')
  assert.ok(hex.includes('00992466'), 'kick on the drum channel')
  assert.ok(hex.includes('83608045'), 'A4 note-off one beat later')
})

test('music: the synthesizer plays the right pitch for the right time', () => {
  const samples = renderScore(score([{ instrument: 'flute', notes: 'A4:2 R:2' }], 60))
  assert.equal(samples.length, Math.ceil((4 + 0.6) * 22_050))
  const hz = frequency(samples, 2205, 22_050)
  assert.ok(Math.abs(hz - 440) < 5, `${hz} Hz`)
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0)
  assert.ok(Math.abs(peak - 0.9) < 1e-6)
  const silentTail = samples.subarray(3 * 22_050).every((s) => s === 0)
  assert.ok(silentTail, 'nothing sounds during the rest')
})

test('music: WAV is 16-bit mono PCM with a correct header', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]))
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(wav.subarray(8, 16).toString('ascii'), 'WAVEfmt ')
  assert.deepEqual([wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34)], [1, 1, 22_050, 16])
  assert.equal(wav.readUInt32LE(40), 8)
  assert.deepEqual([wav.readInt16LE(46), wav.readInt16LE(48)], [32767, -32767])
})

test('music_render: saves a MIDI and a WAV file side by side', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-media-music-'))
  const music = createTools({ outputDir: dir }).find((t) => t.name === 'music_render')
  const out = await music.execute({ tempo: 120, name: 'jingle', tracks: [{ notes: 'C4:1 E4:1 G4:2' }, { instrument: 'drums', notes: 'K:1 S:1 K:1 S:1' }] })
  const [, midiPath] = /MIDI .*: (.+\.mid)$/m.exec(out)
  const [, wavPath] = /WAV .*: (.+\.wav)$/m.exec(out)
  assert.match(out, /^Saved a 2-second piece\./)
  assert.match(midiPath, /jingle-\d{8}T\d{6}Z\.mid$/)
  assert.equal(readFileSync(midiPath).subarray(0, 4).toString('ascii'), 'MThd')
  assert.equal(readFileSync(wavPath).subarray(0, 4).toString('ascii'), 'RIFF')
  await assert.rejects(music.execute({ tracks: [{ notes: 'nope' }] }), /should look like/)
})
