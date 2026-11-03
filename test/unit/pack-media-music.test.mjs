// Media pack, music: the note notation, limits, instruments, the MIDI encoder, the built-in synthesizer,
// loudness mastering, the SoundFont download, and a real SoundFont render when MEDIA_SOUNDFONT_E2E=1 (CI on Linux).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTools, DEFAULT_SOUNDFONT, encodeWav, INSTRUMENTS, loadSoundFont, loudness, master, musicTool, parseScore, peak, pitchToMidi, renderScore,
  resolveSettings, scoreToMidi,
} from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'

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
    { instrument: 'drums', notes: 'K:1 S:1 [K,C]:0.5' },
  ])
  assert.deepEqual(s.tracks[0].events, [
    { start: 0, beats: 1, pitches: [60] },
    { start: 1, beats: 0.5, pitches: [] },
    { start: 1.5, beats: 1.5, pitches: [60, 64, 67] },
  ])
  assert.deepEqual(s.tracks[1].events.map((e) => e.drums), [['K'], ['S'], ['K', 'C']])
  assert.equal(s.beats, 3)
})

test('music: bad scores fail with readable reasons', () => {
  assert.throws(() => score([{ notes: 'C4' }]), /should look like C4:1/)
  assert.throws(() => score([{ notes: 'C4:0' }]), /beats must be a number above 0/)
  assert.throws(() => score([{ instrument: 'drums', notes: 'C4:1' }]), /Drum tracks use K kick, S snare, .* not "C4"/)
  assert.throws(() => score([{ instrument: 'drums', notes: '[K,X]:1' }]), /not "X"/)
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
  assert.ok(hex.includes('00c049' + '00b00a40' + '00b05b28' + '00904566'), 'flute program 73, centre pan, reverb, then A4 note-on')
  assert.ok(hex.includes('00b95b28' + '00992466'), 'reverb, then a kick on the drum channel')
  assert.ok(hex.includes('83608045'), 'A4 note-off one beat later')
})

test('music: every instrument has a General MIDI program, and new ones reach the MIDI file', () => {
  assert.ok(INSTRUMENTS.length > 30 && INSTRUMENTS.includes('koto') && INSTRUMENTS.includes('choir'))
  const hex = scoreToMidi(score([{ instrument: 'koto', notes: 'E5:1' }, { instrument: 'violin', notes: 'A4:1' }])).toString('hex')
  assert.ok(hex.includes('00c06b'), 'koto is program 107')
  assert.ok(hex.includes('00c128' + '00b10a2c'), 'violin is program 40, panned left of centre')
  for (const instrument of INSTRUMENTS) assert.doesNotThrow(() => scoreToMidi(score([{ instrument, notes: instrument === 'drums' ? 'K:1' : 'C4:1' }])), instrument)
})

test('music: the synthesizer plays the right pitch for the right time', () => {
  const audio = renderScore(score([{ instrument: 'flute', notes: 'A4:2 R:2' }], 60))
  const [samples] = audio.channels
  assert.equal(audio.sampleRate, 22_050)
  assert.equal(samples.length, Math.ceil((4 + 0.6) * 22_050))
  const hz = frequency(samples, 2205, 22_050)
  assert.ok(Math.abs(hz - 440) < 5, `${hz} Hz`)
  const silentTail = samples.subarray(3 * 22_050).every((s) => s === 0)
  assert.ok(silentTail, 'nothing sounds during the rest')
})

/** A stereo sine, `seconds` long, at `amplitude`. */
function sine(amplitude, seconds = 3, rate = 48_000, hz = 1000) {
  const channel = Float32Array.from({ length: seconds * rate }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate))
  return { channels: [channel, channel.slice()], sampleRate: rate }
}

test('music: loudness follows BS.1770, and mastering levels to -14 LUFS with a limiter under -1 dBFS', () => {
  // A 1 kHz stereo sine at amplitude 0.1 (-20 dBFS) measures about -20 LUFS.
  assert.ok(Math.abs(loudness(sine(0.1)) + 20) < 0.3, String(loudness(sine(0.1))))
  assert.ok(Math.abs(loudness(sine(0.1, 3, 44_100)) + 20) < 0.3, '44.1 kHz too')
  assert.equal(loudness(sine(0)), -Infinity)
  const quiet = master(sine(0.05))
  assert.ok(Math.abs(quiet.lufs + 14) < 0.01 && Math.abs(loudness(quiet.audio) + 14) < 0.1)
  const spiky = sine(0.01)
  spiky.channels[0][100] = 0.9
  const limited = master(spiky)
  assert.ok(peak(limited.audio) <= 10 ** (-1 / 20) + 1e-6, 'the limiter holds the spike under the ceiling')
  assert.ok(Math.abs(limited.lufs + 14) < 0.3, `still at the target: ${limited.lufs}`)
  const plainGain = 10 ** ((-14 - loudness(spiky)) / 20)
  assert.ok(Math.abs(limited.audio.channels[0][40_000] / spiky.channels[0][40_000] / plainGain - 1) < 0.01, 'far from the spike the gain is the plain level change')
})

test('music: WAV is 16-bit PCM, mono or stereo, with a correct header', () => {
  const mono = encodeWav({ channels: [new Float32Array([0, 1, -1, 0.5])], sampleRate: 22_050 })
  assert.equal(mono.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(mono.subarray(8, 16).toString('ascii'), 'WAVEfmt ')
  assert.deepEqual([mono.readUInt16LE(20), mono.readUInt16LE(22), mono.readUInt32LE(24), mono.readUInt16LE(34)], [1, 1, 22_050, 16])
  assert.equal(mono.readUInt32LE(40), 8)
  assert.deepEqual([mono.readInt16LE(46), mono.readInt16LE(48)], [32767, -32767])
  const stereo = encodeWav({ channels: [new Float32Array([1, 0]), new Float32Array([-1, 0])], sampleRate: 44_100 })
  assert.deepEqual([stereo.readUInt16LE(22), stereo.readUInt32LE(28), stereo.readUInt16LE(32), stereo.readUInt32LE(40)], [2, 176_400, 4, 8])
  assert.deepEqual([stereo.readInt16LE(44), stereo.readInt16LE(46)], [32767, -32767])
})

test('music: the default SoundFont downloads once, is checked, and a local file needs no download', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'pack-media-sf-'))
  const settings = { url: 'https://mirror.example/FluidR3Mono_GM.sf3', cacheDir }
  await assert.rejects(loadSoundFont(settings, async () => Buffer.from('not the file')), /not the expected one/)
  await assert.rejects(loadSoundFont(settings, async () => { throw new Error('offline') }), /Could not download the SoundFont from https:\/\/mirror\.example.* \(offline\)\. Set soundfontUrl/)
  const cached = join(cacheDir, 'soundfonts', 'FluidR3Mono_GM.sf3')
  assert.ok(!existsSync(cached), 'nothing half-written is kept')
  const own = join(cacheDir, 'mine.sf2')
  writeFileSync(own, 'my bank')
  const local = await loadSoundFont({ ...settings, file: own }, async () => assert.fail('no download for a local file'))
  assert.deepEqual([local.bytes.toString(), local.title], ['my bank', 'mine.sf2'])
  assert.equal(DEFAULT_SOUNDFONT.url.endsWith('FluidR3Mono_GM.sf3'), true)
})

test('music_render: saves a MIDI and a WAV file side by side', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-media-music-'))
  const music = musicTool(resolveSettings({ outputDir: dir }), { soundFont: async () => { throw new Error('offline') } })
  const out = await music.execute({ tempo: 120, name: 'jingle', tracks: [{ notes: 'C4:1 E4:1 G4:2' }, { instrument: 'drums', notes: 'K:1 S:1 K:1 S:1' }] })
  const [, midiPath] = /^MIDI: (.+\.mid)$/m.exec(out)
  const [, wavPath] = /WAV .*: (.+\.wav)$/m.exec(out)
  assert.match(out, /^Saved a 2-second piece, mastered to -1[34]\.\d LUFS\./)
  assert.match(out, /WAV \(built-in synth, because the SoundFont could not load: offline\)/)
  assert.match(midiPath, /jingle-\d{8}T\d{6}Z\.mid$/)
  assert.equal(readFileSync(midiPath).subarray(0, 4).toString('ascii'), 'MThd')
  assert.equal(readFileSync(wavPath).subarray(0, 4).toString('ascii'), 'RIFF')
  await assert.rejects(music.execute({ tracks: [{ notes: 'nope' }] }), /should look like/)
})

test('music_render: real instruments from the default SoundFont', { skip: process.env.MEDIA_SOUNDFONT_E2E !== '1' && 'set MEDIA_SOUNDFONT_E2E=1 (downloads about 24 MB)' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-media-music-'))
  const music = createTools({ outputDir: dir, modelCacheDir: join(tmpdir(), 'pack-media-sf-cache') }).find((t) => t.name === 'music_render')
  const out = await music.execute({ tempo: 120, tracks: [{ instrument: 'koto', notes: 'E5:1 D5:1 B4:2' }, { instrument: 'cello', notes: 'E3:4' }, { instrument: 'drums', notes: '[K,C]:1 H:1 S:1 H:1' }] })
  assert.match(out, /WAV \(FluidR3 Mono GM SoundFont, stereo\)/)
  const wav = readFileSync(/WAV .*: (.+\.wav)$/m.exec(out)[1])
  assert.deepEqual([wav.readUInt16LE(22), wav.readUInt32LE(24)], [2, 44_100])
  const frames = (wav.length - 44) / 4
  const left = Float32Array.from({ length: frames }, (_, i) => wav.readInt16LE(44 + i * 4) / 32768)
  const right = Float32Array.from({ length: frames }, (_, i) => wav.readInt16LE(46 + i * 4) / 32768)
  assert.ok(Math.abs(loudness({ channels: [left, right], sampleRate: 44_100 }) + 14) < 0.3)
  assert.ok(left.some((s, i) => Math.abs(s - right[i]) > 0.01), 'instruments are spread across the stereo field')
})
