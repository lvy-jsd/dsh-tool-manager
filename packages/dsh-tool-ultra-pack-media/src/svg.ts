/**
 * SVG safety check and rasterization.
 *
 * The check is an allowlist: an SVG may only point at its own elements
 * (`#id`) or at inline raster images (`data:image/...`). Anything else that
 * could reach a file or the network (external hrefs, `url(...)` to another
 * document, CSS `@import`, DTDs and entities) is refused before the renderer
 * sees it.
 */
import sharp, { type Sharp } from 'sharp'

export type ImageFormat = 'png' | 'jpeg' | 'webp'
export const IMAGE_FORMATS: readonly ImageFormat[] = ['png', 'jpeg', 'webp']

export interface RasterLimits {
  /** Largest SVG source accepted, in bytes. */
  maxSvgBytes: number
  /** Largest output image, in pixels (width × height). */
  maxPixels: number
}

export interface RasterOptions {
  format: ImageFormat
  /** Output width in pixels; the height keeps the aspect ratio. */
  width?: number
}

export interface Raster {
  data: Buffer
  width: number
  height: number
  format: ImageFormat
}

const SVG_START = /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i
const FORBIDDEN = [
  { pattern: /<!DOCTYPE|<!ENTITY/i, reason: 'DTDs and entities are not allowed' },
  { pattern: /<(script|foreignObject|iframe)[\s>/]/i, reason: 'scripts and embedded documents are not allowed' },
  { pattern: /@import/i, reason: 'CSS @import is not allowed' },
]
const REFERENCE = /\b(?:xlink:href|href|src)\s*=\s*(["'])([\s\S]*?)\1/gi
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi
const INLINE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,/i

function isAllowedReference(value: string): boolean {
  const v = value.trim()
  return v.startsWith('#') || INLINE_IMAGE.test(v)
}

function firstBadReference(svg: string): string | undefined {
  for (const pattern of [REFERENCE, CSS_URL]) {
    for (const match of svg.matchAll(pattern)) {
      if (!isAllowedReference(match[2])) return match[2]
    }
  }
  return undefined
}

/** Throws with a readable reason when the SVG is not safe to render. */
export function checkSvg(svg: string, maxBytes: number): void {
  if (Buffer.byteLength(svg, 'utf8') > maxBytes) throw new Error(`SVG is larger than ${maxBytes} bytes.`)
  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(svg)) throw new Error(`Refusing SVG: ${reason}.`)
  }
  if (!SVG_START.test(svg)) throw new Error('Not an SVG document: it must start with <svg>.')
  const bad = firstBadReference(svg)
  if (bad !== undefined) {
    throw new Error(`Refusing SVG: it links to "${bad.slice(0, 80)}". Only #id links and inline data:image/... images are allowed.`)
  }
}

/** Pixel density that renders the SVG at `targetWidth`, within the pixel budget. */
function densityFor(size: { width: number; height: number }, targetWidth: number | undefined, maxPixels: number): number {
  const scale = targetWidth ? targetWidth / size.width : 1
  const pixels = size.width * size.height * scale * scale
  if (pixels > maxPixels) {
    throw new Error(`Output would be ${Math.round(size.width * scale)}×${Math.round(size.height * scale)} pixels, over the ${maxPixels}-pixel limit.`)
  }
  return 72 * scale
}

function encode(image: Sharp, format: ImageFormat): Sharp {
  if (format === 'jpeg') return image.flatten({ background: '#ffffff' }).jpeg({ quality: 90 })
  if (format === 'webp') return image.webp({ quality: 90 })
  return image.png()
}

/** Checks the SVG, then renders it to a raster image. */
export async function rasterizeSvg(svg: string, options: RasterOptions, limits: RasterLimits): Promise<Raster> {
  checkSvg(svg, limits.maxSvgBytes)
  const source = Buffer.from(svg, 'utf8')
  const intrinsic = await sharp(source, { limitInputPixels: limits.maxPixels }).metadata()
  if (!intrinsic.width || !intrinsic.height) throw new Error('The SVG has no size: give the <svg> element width and height, or a viewBox.')
  const density = densityFor({ width: intrinsic.width, height: intrinsic.height }, options.width, limits.maxPixels)
  const image = sharp(source, { density, limitInputPixels: limits.maxPixels })
  const { data, info } = await encode(image, options.format).toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, format: options.format }
}
