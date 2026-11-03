/** svg_render and chart_render. */
import { chartToSvg } from '../chart.js'
import { safeBaseName, saveFile } from '../output.js'
import { NAME_PARAMETER, type Settings, type ToolSpec } from '../settings.js'
import { IMAGE_FORMATS, rasterizeSvg, type ImageFormat, type Raster } from '../svg.js'

const IMAGE_PARAMETERS = {
  format: { type: 'string', enum: [...IMAGE_FORMATS], description: 'Image format: png (default), jpeg or webp.' },
  width: { type: 'integer', description: 'Output width in pixels; the height keeps the aspect ratio. Default: the drawing\'s own size.' },
  name: NAME_PARAMETER,
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

export function imageTools(settings: Settings): ToolSpec[] {
  async function renderAndSave(svg: string, args: any, fallbackName: string): Promise<string> {
    const raster = await rasterizeSvg(svg, { format: formatOf(args.format), width: widthOf(args.width) }, settings.svgLimits)
    const ext = raster.format === 'jpeg' ? 'jpg' : raster.format
    const path = await saveFile(settings.outputDir, safeBaseName(args.name, fallbackName), ext, raster.data)
    return describe(path, raster)
  }

  return [
    {
      name: 'svg_render',
      description: 'Turn an SVG drawing you write (poster, greeting card, icon, diagram, infographic) into a PNG, JPEG or WebP image file. '
        + 'Give the <svg> width and height or a viewBox. Only #id links and inline data:image images are allowed; no external files or URLs.',
      parameters: {
        svg: { type: 'string', required: true, description: 'The complete SVG document, starting with <svg>.' },
        ...IMAGE_PARAMETERS,
      },
      execute: (args) => renderAndSave(String(args.svg ?? ''), args, 'image'),
    },
    {
      name: 'chart_render',
      description: 'Draw a chart (bar, line, pie, scatter, area, heatmap...) from a Vega-Lite spec and save it as an image file. '
        + 'Put the data inline in data.values; loading data from URLs or files is not allowed.',
      parameters: {
        spec: { type: 'object', required: true, description: 'Vega-Lite JSON spec, e.g. {"data":{"values":[...]},"mark":"bar","encoding":{...}}.' },
        ...IMAGE_PARAMETERS,
      },
      execute: async (args) => renderAndSave(await chartToSvg(args.spec), args, 'chart'),
    },
  ]
}
