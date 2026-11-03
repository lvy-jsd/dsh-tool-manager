/**
 * Tool Ultra media pack: images made from code, with no model API and no key.
 *
 * - svg_render: an SVG document (posters, cards, icons, diagrams) → PNG/JPEG/WebP.
 * - chart_render: a Vega-Lite chart spec with inline data → PNG/JPEG/WebP.
 *
 * The model writes the SVG or the chart spec; this pack renders it locally
 * (sharp / librsvg, Vega) and saves the file into one configured folder.
 * Nothing is fetched: external links in an SVG and data URLs in a chart are
 * refused.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { chartToSvg } from './chart.js'
import { DEFAULT_OUTPUT_DIR, safeBaseName, saveFile } from './output.js'
import { IMAGE_FORMATS, rasterizeSvg, type ImageFormat, type Raster, type RasterLimits } from './svg.js'

export { checkSvg, rasterizeSvg } from './svg.js'
export { chartToSvg } from './chart.js'
export { safeBaseName, saveFile } from './output.js'

export const name = 'tool-ultra-pack-media'
export const inject = ['tools']

export interface Config {
  /** Tools to leave out, by name. */
  disable?: string[]
  /** Folder that receives every generated file. */
  outputDir?: string
  /** Largest SVG source accepted, in bytes. */
  maxSvgBytes?: number
  /** Largest output image, in pixels (width × height). */
  maxPixels?: number
}

export const TOOL_NAMES = ['svg_render', 'chart_render'] as const

const DEFAULTS = { maxSvgBytes: 2_000_000, maxPixels: 4096 * 4096 }

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

const COMMON_PARAMETERS = {
  format: { type: 'string', enum: [...IMAGE_FORMATS], description: 'Image format: png (default), jpeg or webp.' },
  width: { type: 'integer', description: 'Output width in pixels; the height keeps the aspect ratio. Default: the drawing\'s own size.' },
  name: { type: 'string', description: 'Short file name hint, e.g. "birthday-card". Letters, digits, - and _ are kept.' },
}

export interface ToolSpec {
  name: (typeof TOOL_NAMES)[number]
  description: string
  parameters: Record<string, unknown>
  execute(args: any): Promise<string>
}

function formatOf(value: unknown): ImageFormat {
  if (value === undefined) return 'png'
  if (!IMAGE_FORMATS.includes(value as ImageFormat)) throw new Error(`format must be one of ${IMAGE_FORMATS.join(', ')}.`)
  return value as ImageFormat
}

function widthOf(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('width must be a positive whole number of pixels.')
  return value as number
}

function describe(path: string, raster: Raster): string {
  const kb = Math.max(1, Math.round(raster.data.byteLength / 1024))
  return `Saved ${raster.format.toUpperCase()} ${raster.width}×${raster.height} (${kb} KB): ${path}`
}

export function createTools(config: Config = {}): ToolSpec[] {
  const outputDir = config.outputDir ?? DEFAULT_OUTPUT_DIR
  const limits: RasterLimits = {
    maxSvgBytes: config.maxSvgBytes ?? DEFAULTS.maxSvgBytes,
    maxPixels: config.maxPixels ?? DEFAULTS.maxPixels,
  }

  async function renderAndSave(svg: string, args: any, fallbackName: string): Promise<string> {
    const raster = await rasterizeSvg(svg, { format: formatOf(args.format), width: widthOf(args.width) }, limits)
    const ext = raster.format === 'jpeg' ? 'jpg' : raster.format
    const path = await saveFile(outputDir, safeBaseName(args.name, fallbackName), ext, raster.data)
    return describe(path, raster)
  }

  return [
    {
      name: 'svg_render',
      description: 'Turn an SVG drawing you write (poster, greeting card, icon, diagram, infographic) into a PNG, JPEG or WebP image file. '
        + 'Give the <svg> width and height or a viewBox. Only #id links and inline data:image images are allowed; no external files or URLs.',
      parameters: {
        svg: { type: 'string', required: true, description: 'The complete SVG document, starting with <svg>.' },
        ...COMMON_PARAMETERS,
      },
      execute: (args) => renderAndSave(String(args.svg ?? ''), args, 'image'),
    },
    {
      name: 'chart_render',
      description: 'Draw a chart (bar, line, pie, scatter, area, heatmap...) from a Vega-Lite spec and save it as an image file. '
        + 'Put the data inline in data.values; loading data from URLs or files is not allowed.',
      parameters: {
        spec: { type: 'object', required: true, description: 'Vega-Lite JSON spec, e.g. {"data":{"values":[...]},"mark":"bar","encoding":{...}}.' },
        ...COMMON_PARAMETERS,
      },
      execute: async (args) => renderAndSave(await chartToSvg(args.spec), args, 'chart'),
    },
  ]
}

function registerPack(ctx: any, tools: string[]) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['toolCatalog'], (c: any) => {
    if (typeof c.toolCatalog?.registerToolPack !== 'function') return
    c.effect(() => c.toolCatalog.registerToolPack({
      id: 'media',
      title: 'Media',
      summary: 'Images made from code: SVG drawings and Vega-Lite charts rendered to PNG/JPEG/WebP. No API keys.',
      source: '@lvy-jsd/dsh-tool-ultra-pack-media',
      tools,
    }))
  })
}

export function apply(ctx: any, config: Config = {}) {
  const disabled = new Set(config.disable ?? [])
  const specs = createTools(config).filter((spec) => !disabled.has(spec.name))
  // List the pack in Tool Ultra's panel and make it loadable as pack:media.
  registerPack(ctx, specs.map((spec) => spec.name))
  for (const spec of specs) {
    ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: (args: unknown) => spec.execute(args),
    } as any))
  }
}

export default { name, inject, apply }
