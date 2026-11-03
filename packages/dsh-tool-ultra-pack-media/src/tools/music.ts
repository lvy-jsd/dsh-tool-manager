/** music_render. */
import { DRUM_HELP } from '../audio/instruments.js'
import { encodeWav, master, type Audio } from '../audio/master.js'
import { scoreToMidi } from '../audio/midi.js'
import { renderMidi } from '../audio/sampler.js'
import { INSTRUMENTS, parseScore } from '../audio/score.js'
import { loadSoundFont, type SoundFont } from '../audio/soundfont.js'
import { renderScore } from '../audio/synth.js'
import { onceUntilFailure } from '../once.js'
import { safeBaseName, saveFile } from '../output.js'
import { NAME_PARAMETER, type Settings, type ToolSpec } from '../settings.js'

const NOTATION_HELP = 'Notes play one after another as <sound>:<beats>: "C4:1 E4:0.5 G4:1/2 R:1 [C4,E4,G4]:2" '
  + `(C4 = middle C, # sharp, b flat, R rest, [..] chord). Drum tracks use letters: ${DRUM_HELP}; [K,C]:1 hits two at once.`

const TRACK = {
  type: 'object',
  additionalProperties: false,
  properties: {
    instrument: { type: 'string', enum: [...INSTRUMENTS], description: 'Default piano. drums uses the drum letters.' },
    notes: { type: 'string', required: true, description: 'The track\'s notes, e.g. "C4:1 D4:1 E4:2".' },
    volume: { type: 'number', description: '0-1. Default 0.8.' },
  },
}

export interface MusicDeps {
  soundFont?: () => Promise<SoundFont>
}

export function musicTool(settings: Settings, deps: MusicDeps = {}): ToolSpec {
  const soundFont = onceUntilFailure(deps.soundFont ?? (() => loadSoundFont(settings.soundFont)))

  /** Real instruments from the SoundFont, or the built-in synth with the reason it stood in. */
  async function perform(midi: Buffer, score: ReturnType<typeof parseScore>): Promise<{ audio: Audio; source: string }> {
    try {
      const font = await soundFont()
      return { audio: await renderMidi(midi, font.bytes), source: `${font.title} SoundFont, stereo` }
    } catch (error: any) {
      return { audio: renderScore(score), source: `built-in synth, because the SoundFont could not load: ${error.message}` }
    }
  }

  async function renderMusic(args: any): Promise<string> {
    const score = parseScore({ tempo: args.tempo, tracks: args.tracks }, settings.scoreLimits)
    const name = safeBaseName(args.name, 'music')
    const midi = scoreToMidi(score)
    const midiPath = await saveFile(settings.outputDir, name, 'mid', midi)
    const { audio, source } = await perform(midi, score)
    const mastered = master(audio)
    const wavPath = await saveFile(settings.outputDir, name, 'wav', encodeWav(mastered.audio))
    const seconds = Math.round((score.beats * 60) / score.tempo)
    const level = Number.isFinite(mastered.lufs) ? `, mastered to ${mastered.lufs.toFixed(1)} LUFS` : ''
    return `Saved a ${seconds}-second piece${level}.\nMIDI: ${midiPath}\nWAV (${source}): ${wavPath}`
  }

  return {
    name: 'music_render',
    description: 'Compose a piece (song sketch, jingle, ringtone, background music for a video) by writing notes for up to 16 instruments, '
      + 'and save it as a WAV played with real recorded instruments (a General MIDI SoundFont, with reverb and stereo placement, '
      + 'mastered to streaming loudness) plus a MIDI file. ' + NOTATION_HELP,
    parameters: {
      tempo: { type: 'number', description: 'Beats per minute, 20-300. Default 100.' },
      tracks: { type: 'array', required: true, description: 'Up to 16 tracks that play together.', items: TRACK },
      name: NAME_PARAMETER,
    },
    execute: renderMusic,
  }
}
