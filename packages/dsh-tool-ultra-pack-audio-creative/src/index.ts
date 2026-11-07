/**
 * Tool Ultra Audio Creative pack:
 * High-fidelity TTS speech synthesis (Edge-TTS) and ffmpeg audio clipping/mixing.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname, extname, resolve } from 'node:path'

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

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}

function seconds(value: string): number {
  if (!/^(?:\d+:)?(?:\d+:)?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid timestamp.')
  const total = value.split(':').reduce((n, part) => n * 60 + Number(part), 0)
  if (!Number.isFinite(total) || total < 0 || total > 86400) throw new Error('Timestamp out of range.')
  return total
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
          description: 'Text sent to Microsoft Edge online TTS; do not include confidential material.',
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
          description: 'Optional output destination path (.wav or .mp3). Defaults to daily artifact storage.',
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

        if (args.text.length > 10000) throw new Error('Text limit is 10000 characters.')
        const voice = args.voice || defaultVoice
        if (!/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/.test(voice)) throw new Error('Invalid voice name.')
        if (args.rate && !/^[+-]?\d{1,3}%$/.test(args.rate)) throw new Error('Invalid rate.')
        if (args.pitch && !/^[+-]?\d{1,3}Hz$/.test(args.pitch)) throw new Error('Invalid pitch.')
        const outPath = resolve(args.output || defaultArtifactPath('wav', artifactsDir))
        if (!['.mp3', '.wav'].includes(extname(outPath).toLowerCase())) throw new Error('Output must be .wav or .mp3.')
        if (existsSync(outPath)) throw new Error('Output already exists; refusing to overwrite.')
        await mkdir(dirname(outPath), { recursive: true })
        const temp = await mkdtemp(join(dirname(outPath), '.tts-'))
        const tts = new MsEdgeTTS({ connectionTimeoutMs: 15000, synthesisTimeoutMs: 30000 })
        let stream: ReturnType<MsEdgeTTS['toStream']>['audioStream'] | undefined
        const timer = setTimeout(() => {
          stream?.destroy(new Error('Synthesis deadline exceeded.'))
          tts.close()
        }, 45000)
        try {
          await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
          stream = tts.toStream(escapeXml(args.text), { rate: args.rate || '0%', pitch: args.pitch || '0Hz' }).audioStream
          const chunks: Buffer[] = []
          let bytes = 0
          for await (const chunk of stream) {
            bytes += chunk.length
            if (bytes > 10_000_000) throw new Error('Synthesis exceeded 10 MB.')
            chunks.push(Buffer.from(chunk))
          }
          if (!bytes) throw new Error('TTS returned no audio.')
          const mp3 = join(temp, 'speech.mp3')
          await writeFile(mp3, Buffer.concat(chunks), { flag: 'wx' })
          if (extname(outPath).toLowerCase() === '.mp3') {
            await writeFile(outPath, Buffer.concat(chunks), { flag: 'wx' })
          } else {
            await execFileAsync(ffmpegPath, ['-nostdin', '-n', '-i', mp3, '-vn', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', outPath], { timeout: 30000, maxBuffer: 256000 })
          }
          return `Audio synthesized successfully: "${outPath}" (Voice: ${voice}; online Microsoft Edge TTS).`
        } catch (e: any) {
          throw new Error(`[Audio Synthesis Error] ${e.message}`)
        } finally {
          clearTimeout(timer)
          stream?.destroy()
          tts.close()
          await rm(temp, { recursive: true, force: true })
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

        const outPath = resolve(args.output || defaultArtifactPath('wav', artifactsDir))
        if (existsSync(outPath)) throw new Error('Output already exists; refusing to overwrite.')
        await mkdir(dirname(outPath), { recursive: true })

        const start = seconds(args.start)
        if (args.duration && args.to) throw new Error('Specify duration or to, not both.')
        const duration = args.duration ? seconds(args.duration) : args.to ? seconds(args.to) - start : undefined
        if (duration !== undefined && duration <= 0) throw new Error('Duration must be positive and end must follow start.')
        const ffmpegArgs = ['-nostdin', '-n', '-ss', String(start), '-i', resolve(args.input)]
        if (duration !== undefined) ffmpegArgs.push('-t', String(duration))
        ffmpegArgs.push('-vn', outPath)

        try {
          await execFileAsync(ffmpegPath, ffmpegArgs, { timeout: 60000, maxBuffer: 256000 })
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

        const outPath = resolve(args.output || defaultArtifactPath('wav', artifactsDir))
        if (existsSync(outPath)) throw new Error('Output already exists; refusing to overwrite.')
        await mkdir(dirname(outPath), { recursive: true })

        const voiceVol = args.voice_volume ?? 1.0
        const bgmVol = args.bgm_volume ?? 0.25

        if (![voiceVol, bgmVol].every(v => Number.isFinite(v) && v >= 0 && v <= 4)) throw new Error('Volumes must be finite numbers between 0 and 4.')
        // amix filter: volume adjustments on each input, mixed down to 2 channels
        const filterStr = `[0:a]volume=${voiceVol}[a1];[1:a]volume=${bgmVol}[a2];[a1][a2]amix=inputs=2:duration=first:dropout_transition=2[out]`

        const ffmpegArgs = [
          '-nostdin', '-n',
          '-i',
          resolve(args.voice),
          '-i',
          resolve(args.bgm),
          '-filter_complex',
          filterStr,
          '-map',
          '[out]',
          outPath,
        ]

        try {
          await execFileAsync(ffmpegPath, ffmpegArgs, { timeout: 60000, maxBuffer: 256000 })
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
