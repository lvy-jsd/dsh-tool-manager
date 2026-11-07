/**
 * Tool Ultra Image Creative pack:
 * High-performance image manipulation using sharp, image inspection, and generation adapter.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export const name = 'tool-ultra-pack-image-creative'
export const inject = ['tools']

export interface Config {
  disable?: string[]
  defaultEndpoint?: string
  artifactsDir?: string
}

export const TOOL_NAMES = ['image_edit', 'image_metadata', 'image_generate'] as const

const DEFAULTS = {
  endpoint: 'http://127.0.0.1:8188',
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
  const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  return join(folder, filename)
}

export function createTools(config: Config = {}) {
  const artifactsDir = config.artifactsDir || DEFAULTS.artifactsDir

  return [
    {
      name: 'image_metadata' as const,
      description:
        'Inspect an image file and return its dimensions (width, height), format, color space, channels, and density without loading raw image pixels into model context.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Local file path to the image file.',
        },
      },
      async execute(args: { path: string }): Promise<string> {
        if (!args.path || !args.path.trim()) {
          throw new Error('Image path cannot be empty.')
        }
        if (!existsSync(args.path)) {
          throw new Error(`[Image Creative Error] File not found: "${args.path}"`)
        }

        try {
          const meta = await sharp(args.path).metadata()
          return [
            `Image: "${args.path}"`,
            `- Format: ${meta.format ?? 'unknown'}`,
            `- Dimensions: ${meta.width ?? 0} x ${meta.height ?? 0} px`,
            `- Color Space: ${meta.space ?? 'unknown'} (${meta.channels ?? 0} channels)`,
            `- Has Alpha: ${meta.hasAlpha ? 'yes' : 'no'}`,
            `- Orientation: ${meta.orientation ?? 1}`,
          ].join('\n')
        } catch (e: any) {
          throw new Error(`[Image Creative Error] Failed to read image metadata for "${args.path}": ${e.message}`)
        }
      },
    },
    {
      name: 'image_edit' as const,
      description:
        'Transform and edit an image: resize, crop, rotate, flip, convert format (png, jpeg, webp, avif), and adjust quality. Saves result to an artifact path.',
      parameters: {
        input: {
          type: 'string',
          required: true,
          description: 'Path to source image file.',
        },
        output: {
          type: 'string',
          description: 'Optional destination file path. If omitted, automatically saves into daily artifact storage.',
        },
        width: {
          type: 'integer',
          description: 'Target width in pixels.',
        },
        height: {
          type: 'integer',
          description: 'Target height in pixels.',
        },
        fit: {
          type: 'string',
          description: 'Resize fit mode: "cover", "contain", "fill", "inside", "outside" (default "cover").',
        },
        rotate: {
          type: 'integer',
          description: 'Rotation angle in degrees (e.g. 90, 180, 270).',
        },
        flip: {
          type: 'boolean',
          description: 'Flip image vertically.',
        },
        flop: {
          type: 'boolean',
          description: 'Flop image horizontally (mirror).',
        },
        grayscale: {
          type: 'boolean',
          description: 'Convert image to black and white grayscale.',
        },
        format: {
          type: 'string',
          description: 'Target format: "png", "jpeg", "webp", or "avif".',
        },
        quality: {
          type: 'integer',
          description: 'Encoding quality between 1 and 100 (for jpeg, webp, avif).',
        },
      },
      async execute(args: {
        input: string
        output?: string
        width?: number
        height?: number
        fit?: string
        rotate?: number
        flip?: boolean
        flop?: boolean
        grayscale?: boolean
        format?: string
        quality?: number
      }): Promise<string> {
        if (!args.input || !args.input.trim()) {
          throw new Error('Input image path cannot be empty.')
        }
        if (!existsSync(args.input)) {
          throw new Error(`[Image Creative Error] Source image not found: "${args.input}"`)
        }

        try {
          let pipeline = sharp(args.input)

          if (args.rotate) pipeline = pipeline.rotate(args.rotate)
          if (args.flip) pipeline = pipeline.flip()
          if (args.flop) pipeline = pipeline.flop()
          if (args.grayscale) pipeline = pipeline.grayscale()

          if (args.width || args.height) {
            const fit = (args.fit as any) || 'cover'
            pipeline = pipeline.resize({
              width: args.width,
              height: args.height,
              fit,
            })
          }

          const targetFormat = args.format?.toLowerCase() || 'png'
          const quality = args.quality ? Math.min(100, Math.max(1, args.quality)) : 85

          if (targetFormat === 'jpeg' || targetFormat === 'jpg') {
            pipeline = pipeline.jpeg({ quality })
          } else if (targetFormat === 'webp') {
            pipeline = pipeline.webp({ quality })
          } else if (targetFormat === 'avif') {
            pipeline = pipeline.avif({ quality })
          } else {
            pipeline = pipeline.png()
          }

          const outPath = args.output || defaultArtifactPath(targetFormat, artifactsDir)
          await mkdir(dirname(outPath), { recursive: true })

          await pipeline.toFile(outPath)
          const resultMeta = await sharp(outPath).metadata()

          return [
            `Image edited successfully: "${outPath}"`,
            `- Dimensions: ${resultMeta.width} x ${resultMeta.height} px`,
            `- Format: ${resultMeta.format}`,
          ].join('\n')
        } catch (e: any) {
          throw new Error(`[Image Creative Error] Failed to process image "${args.input}": ${e.message}`)
        }
      },
    },
    {
      name: 'image_generate' as const,
      description:
        'Generate an image from a descriptive prompt using a local ComfyUI/SD endpoint or OpenAI-compatible image endpoint.',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Text description of the image to generate.',
        },
        size: {
          type: 'string',
          description: 'Image dimensions e.g. "1024x1024", "512x512" (default "1024x1024").',
        },
        endpoint: {
          type: 'string',
          description: 'Optional custom generation endpoint URL.',
        },
        output: {
          type: 'string',
          description: 'Optional file path to save the generated image.',
        },
      },
      async execute(args: {
        prompt: string
        size?: string
        endpoint?: string
        output?: string
      }): Promise<string> {
        if (!args.prompt || !args.prompt.trim()) {
          throw new Error('Prompt cannot be empty.')
        }

        const endpoint = args.endpoint || config.defaultEndpoint || DEFAULTS.endpoint
        const size = args.size || '1024x1024'

        try {
          const res = await fetch(`${endpoint.replace(/\/$/, '')}/v1/images/generations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: args.prompt,
              size,
              response_format: 'b64_json',
            }),
            signal: AbortSignal.timeout(60_000),
          })

          if (!res.ok) {
            throw new Error(`Generation endpoint returned HTTP ${res.status}: ${await res.text()}`)
          }

          const data = (await res.json()) as any
          const b64 = data.data?.[0]?.b64_json
          if (!b64) {
            throw new Error('Invalid endpoint response: no image b64_json returned.')
          }

          const buffer = Buffer.from(b64, 'base64')
          const outPath = args.output || defaultArtifactPath('png', artifactsDir)
          await mkdir(dirname(outPath), { recursive: true })
          await writeFile(outPath, buffer)

          return `Image generated successfully and saved to "${outPath}" (${size}).`
        } catch (e: any) {
          throw new Error(`[Image Generation Error] Failed generating image: ${e.message}`)
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
          id: 'image-creative',
          title: 'Image Creative & Editing',
          summary: 'High-performance pixel manipulation (sharp), image inspection, and AI generation adapters.',
          source: '@lvy-jsd/dsh-tool-ultra-pack-image-creative',
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
