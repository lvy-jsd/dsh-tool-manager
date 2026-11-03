/** music_render. */
import { scoreToMidi } from '../audio/midi.js'
import { INSTRUMENTS, parseScore } from '../audio/score.js'
import { encodeWav, renderScore } from '../audio/synth.js'
import { safeBaseName, saveFile } from '../output.js'
import { NAME_PARAMETER, type Settings, type ToolSpec } from '../settings.js'

const NOTATION_HELP = 'Notes play one after another as <sound>:<beats>: "C4:1 E4:0.5 G4:1/2 R:1 [C4,E4,G4]:2" '
  + '(C4 = middle C, # sharp, b flat, R rest, [..] chord). Drum tracks use K kick, S snare, H hi-hat.'

const TRACK = {
  type: 'object',
  additionalProperties: false,
  properties: {
    instrument: { type: 'string', enum: [...INSTRUMENTS], description: 'Default piano.' },
    notes: { type: 'string', required: true, description: 'The track\'s notes, e.g. "C4:1 D4:1 E4:2".' },
    volume: { type: 'number', description: '0-1. Default 0.8.' },
  },
}

export function musicTool(settings: Settings): ToolSpec {
  async function renderMusic(args: any): Promise<string> {
    const score = parseScore({ tempo: args.tempo, tracks: args.tracks }, settings.scoreLimits)
    const name = safeBaseName(args.name, 'music')
    const midiPath = await saveFile(settings.outputDir, name, 'mid', scoreToMidi(score))
    const wavPath = await saveFile(settings.outputDir, name, 'wav', encodeWav(renderScore(score)))
    const seconds = Math.round((score.beats * 60) / score.tempo)
    return `Saved a ${seconds}-second piece.\nMIDI (real instrument sounds on phones and computers): ${midiPath}\nWAV (simple built-in synth): ${wavPath}`
  }

  return {
    name: 'music_render',
    description: 'Compose a short piece (melody, jingle, ringtone, background loop) by writing notes, and save it as a MIDI file and a WAV file. '
      + NOTATION_HELP,
    parameters: {
      tempo: { type: 'number', description: 'Beats per minute, 20-300. Default 100.' },
      tracks: { type: 'array', required: true, description: 'Up to 16 tracks that play together.', items: TRACK },
      name: NAME_PARAMETER,
    },
    execute: renderMusic,
  }
}
