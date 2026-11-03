/** html_render: a page of HTML and CSS → a still image, or an animated GIF/WebP of its CSS animations. */
import { createHtmlRenderer, type HtmlRenderer, type MovingFormat, type Picture, type StillFormat } from '../html/render.js'
import { safeBaseName, saveFile } from '../output.js'
import { NAME_PARAMETER, type Settings, type ToolSpec } from '../settings.js'

const STILL: readonly StillFormat[] = ['png', 'jpeg', 'webp']
const MOVING: readonly MovingFormat[] = ['gif', 'webp']
const LIMITS = { width: { min: 16, max: 4096, default: 1080 }, scale: { min: 1, max: 3 }, seconds: { min: 0.5, max: 10 } }
const ANIMATION_FPS = 20
const NO_FONTS_NOTE = '\nNote: no font files were found on the server, so only Latin text can be drawn. Install a CJK font (e.g. fonts-noto-cjk) or set fontFiles.'

function wholeNumber(value: unknown, label: string, { min, max }: { min: number; max: number }): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`)
  return value as number
}

function secondsOf(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const { min, max } = LIMITS.seconds
  if (typeof value !== 'number' || !(value >= min && value <= max)) throw new Error(`seconds must be from ${min} to ${max}.`)
  return value
}

function formatOf(value: unknown, animated: boolean): StillFormat | MovingFormat {
  const allowed: readonly string[] = animated ? MOVING : STILL
  const format = value ?? allowed[0]
  if (!allowed.includes(format as string)) throw new Error(`format must be one of ${allowed.join(', ')}${animated ? ' when seconds is set' : ''}.`)
  return format as StillFormat | MovingFormat
}

function describe(path: string, picture: Picture, label: string): string {
  const kb = Math.max(1, Math.round(picture.data.byteLength / 1024))
  return `Saved ${label} ${picture.width}×${picture.height} (${kb} KB): ${path}`
}

export function htmlTool(settings: Settings, renderer: HtmlRenderer = createHtmlRenderer(settings.html)): ToolSpec {
  async function render(args: any): Promise<string> {
    const page = await renderer.open(String(args.html ?? ''))
    const seconds = secondsOf(args.seconds)
    const format = formatOf(args.format, seconds !== undefined)
    const size = {
      width: wholeNumber(args.width, 'width', LIMITS.width) ?? LIMITS.width.default,
      height: wholeNumber(args.height, 'height', LIMITS.width),
      scale: wholeNumber(args.scale, 'scale', LIMITS.scale) ?? 1,
    }
    const picture = seconds === undefined
      ? await renderer.still(page, size, format as StillFormat)
      : await renderer.moving(page, size, format as MovingFormat, seconds, ANIMATION_FPS)
    const ext = format === 'jpeg' ? 'jpg' : format
    const path = await saveFile(settings.outputDir, safeBaseName(args.name, 'page'), ext, picture.data)
    const label = seconds === undefined ? format.toUpperCase() : `animated ${format.toUpperCase()} (${seconds} s)`
    return describe(path, picture, label) + ((await renderer.hasFonts()) ? '' : NO_FONTS_NOTE)
  }

  return {
    name: 'html_render',
    description: 'Design an image with HTML and CSS (poster, social card, slide, infographic, menu, certificate, quote card, UI mockup) and save it as PNG, JPEG or WebP (a still shows the design after its animations finish); '
      + 'with seconds, save its CSS @keyframes animations as an animated GIF or WebP (sticker, banner). Modern CSS works: flexbox, grid, gradients, '
      + 'gradient text, shadows, blur and other filters, blend modes, border-radius, transforms. Chinese and emoji fonts are built in (font-family sans-serif, '
      + 'serif or monospace). No scripts and no web links: pictures must be inline data:image/... or files from the output folder by name '
      + '(e.g. a chart made by chart_render). Spinning: use rotate() steps under 180° per keyframe.',
    parameters: {
      html: { type: 'string', required: true, description: 'The page: HTML with a <style> block. Size the root element to the page, e.g. width:100%;height:100%;display:flex.' },
      width: { type: 'integer', description: `Page width in CSS pixels, ${LIMITS.width.min}-${LIMITS.width.max}. Default ${LIMITS.width.default}.` },
      height: { type: 'integer', description: 'Page height in CSS pixels. Default: as tall as the content.' },
      scale: { type: 'integer', description: 'Pixel density 1-3 (2 = sharp on phones). Default 1.' },
      seconds: { type: 'number', description: `Make an animated image of the first ${LIMITS.seconds.min}-${LIMITS.seconds.max} seconds of the CSS animations.` },
      format: { type: 'string', enum: ['png', 'jpeg', 'webp', 'gif'], description: 'Still: png (default), jpeg, webp. Animated: gif (default) or webp.' },
      name: NAME_PARAMETER,
    },
    execute: render,
  }
}
