/**
 * Tool Ultra Audio Creative pack:
 * High-fidelity TTS speech synthesis (Edge-TTS) and ffmpeg audio clipping/mixing.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const execFileAsync = promisify(execFile)

export const name = 'tool-ultra-pack-audio-creative'
export const inject = ['tools']

export interface Config {
  disable?: string[]
  defaultVoice?: string
  ffmpegPath?: string
  artifactsDir?: string
}

export const TOOL_NAMES = ['audio_synthesize', 'audio_cut', 'audio_mix'] as const

const DEFAULTS = {
  voice: 'zh-CN-XiaoxiaoNeural',
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  artifactsDir: process.env.SWIFTNEST_ARTIFACTS_DIR || join(homedir(), 'dsh-artifacts'),
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

function defaultArtifactPath(ext: string, artifactsDir: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const folder = join(artifactsDir, dateStr)
  const filename = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  return join(folder, filename)
}

export function createTools(config: Config = {}) {
  const defaultVoice = config.defaultVoice || DEFAULTS.voice
  const ffmpegPath = config.ffmpegPath || DEFAULTS.ffmpegPath
  const artifactsDir = config.artifactsDir || DEFAULTS.artifactsDir

  return [
    {
      name: 'audio_synthesize' as const,
      description:
        'Synthesize high-fidelity natural speech from text using neural TTS (Edge-TTS). Supports Chinese, English, and other languages with multiple voice options (e.g. "zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural", "en-US-JennyNeural").',
      parameters: {
        text: {
          type: 'string',
          required: true,
          description: 'Text script to synthesize into audio.',
        },
        voice: {
          type: 'string',
          description: `Voice model name (defaults to "${defaultVoice}").`,
        },
        rate: {
          type: 'string',
          description: 'Speed adjustment e.g. "+10%", "-20%" (default "0%").',
        },
        pitch: {
          type: 'string',
          description: 'Pitch adjustment e.g. "+5Hz", "-10Hz" (default "0Hz").',
        },
        output: {
          type: 'string',
          description: 'Optional output destination path (.mp3). Defaults to daily artifact storage.',
        },
      },
      async execute(args: {
        text: string
        voice?: string
        rate?: string
        pitch?: string
        output?: string
      }): Promise<string> {
        if (!args.text || !args.text.trim()) {
          throw new Error('Text to synthesize cannot be empty.')
        }

        const voice = args.voice || defaultVoice
        const outPath = args.output || defaultArtifactPath('mp3', artifactsDir)
        await mkdir(dirname(outPath), { recursive: true })

        try {
          const tts = new MsEdgeTTS()
          await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
          await tts.toFile(outPath, args.text, {
            rate: args.rate || '0%',
            pitch: args.pitch || '0Hz',
          })

          return `Audio synthesized successfully: "${outPath}" (Voice: ${voice}).`
        } catch (e: any) {
          throw new Error(`[Audio Synthesis Error] Failed synthesizing speech: ${e.message}`)
        }
      },
    },
    {
      name: 'audio_cut' as const,
      description:
        'Trim and cut an audio file between start and end timestamps using ffmpeg.',
      parameters: {
        input: {
          type: 'string',
          required: true,
          description: 'Source audio file path.',
        },
        start: {
          type: 'string',
          required: true,
          description: 'Start timestamp (e.g. "00:00:05" or seconds e.g. "5").',
        },
        duration: {
          type: 'string',
          description: 'Duration to cut (e.g. "00:00:10" or "10").',
        },
        to: {
          type: 'string',
          description: 'End timestamp (e.g. "00:00:15" or "15").',
        },
        output: {
          type: 'string',
          description: 'Optional destination file path. If omitted, automatically saves into daily artifact storage.',
        },
      },
      async execute(args: {
        input: string
        start: string
        duration?: string
        to?: string
        output?: string
      }): Promise<string> {
        if (!args.input || !args.input.trim()) {
          throw new Error('Input audio path cannot be empty.')
        }
        if (!existsSync(args.input)) {
          throw new Error(`[Audio Cut Error] Source file not found: "${args.input}"`)
        }

        const outPath = args.output || defaultArtifactPath('mp3', artifactsDir)
        await mkdir(dirname(outPath), { recursive: true })

        const ffmpegArgs = ['-y', '-ss', args.start, '-i', args.input]
        if (args.duration) {
          ffmpegArgs.push('-t', args.duration)
        } else if (args.to) {
          ffmpegArgs.push('-to', args.to)
        }
        ffmpegArgs.push('-c', 'copy', outPath)

        try {
          await execFileAsync(ffmpegPath, ffmpegArgs)
          return `Audio clipped successfully and saved to "${outPath}".`
        } catch (e: any) {
          throw new Error(`[Audio Cut Error] ffmpeg trimming failed: ${e.message}`)
        }
      },
    },
    {
      name: 'audio_mix' as const,
      description:
        'Mix two audio tracks (e.g. voiceover and background music) with volume balance using ffmpeg.',
      parameters: {
        voice: {
          type: 'string',
          required: true,
          description: 'Path to main voice/speech audio file.',
        },
        bgm: {
          type: 'string',
          required: true,
          description: 'Path to background music audio file.',
        },
        voice_volume: {
          type: 'number',
          description: 'Volume multiplier for voice (e.g. 1.0 = 100%, 1.2 = 120%, default 1.0).',
        },
        bgm_volume: {
          type: 'number',
          description: 'Volume multiplier for background music (e.g. 0.2 = 20%, default 0.25).',
        },
        output: {
          type: 'string',
          description: 'Optional output destination path. Defaults to daily artifact storage.',
        },
      },
      async execute(args: {
        voice: string
        bgm: string
        voice_volume?: number
        bgm_volume?: number
        output?: string
      }): Promise<string> {
        if (!existsSync(args.voice)) {
          throw new Error(`[Audio Mix Error] Voice track not found: "${args.voice}"`)
        }
        if (!existsSync(args.bgm)) {
          throw new Error(`[Audio Mix Error] Background track not found: "${args.bgm}"`)
        }

        const outPath = args.output || defaultArtifactPath('mp3', artifactsDir)
        await mkdir(dirname(outPath), { recursive: true })

        const voiceVol = args.voice_volume ?? 1.0
        const bgmVol = args.bgm_volume ?? 0.25

        // amix filter: volume adjustments on each input, mixed down to 2 channels
        const filterStr = `[0:a]volume=${voiceVol}[a1];[1:a]volume=${bgmVol}[a2];[a1][a2]amix=inputs=2:duration=first:dropout_transition=2[out]`

        const ffmpegArgs = [
          '-y',
          '-i',
          args.voice,
          '-i',
          args.bgm,
          '-filter_complex',
          filterStr,
          '-map',
          '[out]',
          outPath,
        ]

        try {
          await execFileAsync(ffmpegPath, ffmpegArgs)
          return `Audio mixed successfully and saved to "${outPath}".`
        } catch (e: any) {
          throw new Error(`[Audio Mix Error] ffmpeg audio mixing failed: ${e.message}`)
        }
      },
    },
  ]
}

export function apply(ctx: any, config: Config = {}) {
  const disabled = new Set(config.disable ?? [])

  if (typeof ctx.inject === 'function') {
    ctx.inject(['toolCatalog'], (c: any) => {
      if (typeof c.toolCatalog?.registerToolPack !== 'function') return
      c.effect(() =>
        c.toolCatalog.registerToolPack({
          id: 'audio-creative',
          title: 'Audio Creative & Speech Synthesis',
          summary: 'Natural neural TTS voice synthesis, audio trimming, and background music mixing via ffmpeg.',
          source: '@lvy-jsd/dsh-tool-ultra-pack-audio-creative',
          tools: TOOL_NAMES.filter((n) => !disabled.has(n)),
        }),
      )
    })
  }

  for (const spec of createTools(config)) {
    if (disabled.has(spec.name)) continue
    ctx.tools.register(
      defineTool({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: TEXT_OUTPUT,
        isConcurrencySafe: () => true,
        execute: (args: unknown) => spec.execute(args as any),
      } as any),
    )
  }
}
