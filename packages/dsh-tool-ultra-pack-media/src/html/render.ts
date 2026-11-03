/**
 * HTML and CSS to pixels with Takumi (Rust, MIT/Apache-2.0): flexbox and
 * grid, gradients, shadows, filters, blend modes, CSS animations and the
 * host's fonts, with no browser, no scripts and no network. One renderer is
 * shared by every call; fonts are loaded once, on first use.
 */
import { readFile } from 'node:fs/promises'
import type { InputFolders } from '../files.js'
import { preparePage, type HtmlLimits, type PageImage } from './check.js'
import { chooseFonts, fcMatch, type FindFont } from './fonts.js'

export interface HtmlSettings extends HtmlLimits {
  /** Largest output, in pixels (width × height, after scaling). */
  maxPixels: number
  /** Font files to load before the host's own fonts. */
  fontFiles: string[]
  /** Default language: picks regional glyphs, e.g. Simplified Chinese for zh-CN. */
  lang: string
  folders: InputFolders
}

export type StillFormat = 'png' | 'jpeg' | 'webp'
export type MovingFormat = 'gif' | 'webp'

export interface PageSize {
  width: number
  /** Unset: as tall as the content. */
  height?: number
  /** Device pixel ratio: 2 draws every CSS pixel as 2×2 pixels. */
  scale: number
}

interface OutputBox {
  width: number
  height: number
  devicePixelRatio: number
}

export interface Picture {
  data: Buffer
  width: number
  height: number
}

/** A checked page with its pictures, ready to draw any number of times. */
export interface Page {
  html: string
  images: PageImage[]
}

type Takumi = import('@takumi-rs/core').Renderer

/** A time after any reasonable entrance animation has finished, so a still shows the finished design. */
const SETTLED_MS = 600_000

export function createHtmlRenderer(settings: HtmlSettings, findFont: FindFont = fcMatch) {
  let ready: Promise<{ takumi: Takumi; fontCount: number }> | undefined

  async function start() {
    const { Renderer } = await import('@takumi-rs/core')
    const takumi = new Renderer()
    let fontCount = 0
    for (const font of await chooseFonts(settings.fontFiles, findFont)) {
      const data = await readFile(font.path).catch(() => undefined)
      if (!data) continue
      await takumi.registerFont(font.generic ? { data, generic: font.generic } : data)
      fontCount++
    }
    return { takumi, fontCount }
  }
  const renderer = () => (ready ??= start())

  /** The output in pixels: the page size times its density, within the pixel budget. */
  async function outputBox(page: Page, size: PageSize): Promise<OutputBox> {
    const cssHeight = size.height ?? (await (await renderer()).takumi.measure(page.html, { width: size.width, lang: settings.lang, images: page.images })).height
    const width = Math.round(size.width * size.scale)
    const height = Math.ceil(cssHeight * size.scale)
    if (width * height > settings.maxPixels) throw new Error(`Output would be ${width}×${height} pixels, over the ${settings.maxPixels}-pixel limit.`)
    return { width, height, devicePixelRatio: size.scale }
  }

  return {
    /** Checks the HTML and reads its pictures. */
    open: async (html: string): Promise<Page> => ({ html, images: await preparePage(html, settings, settings.folders) }),

    /** True when at least one font file loaded; without one only Latin text draws. */
    hasFonts: async () => (await renderer()).fontCount > 0,

    /** One still image, `timeMs` into the page's CSS animations: by default long after they settle. */
    async still(page: Page, size: PageSize, format: StillFormat | 'raw', timeMs = SETTLED_MS): Promise<Picture> {
      const box = await outputBox(page, size)
      const { takumi } = await renderer()
      const encoding = format === 'raw' || format === 'png' ? { format } : { format, quality: 90 }
      const data = await takumi.render(page.html, { ...box, timeMs, lang: settings.lang, images: page.images, ...encoding })
      return { data: Buffer.from(data), width: box.width, height: box.height }
    },

    /** An animated GIF or WebP of the page's first `seconds` of CSS animation. */
    async moving(page: Page, size: PageSize, format: MovingFormat, seconds: number, fps: number): Promise<Picture> {
      const box = await outputBox(page, size)
      const { takumi } = await renderer()
      const scenes = [{ node: page.html, durationMs: Math.round(seconds * 1000) }]
      const quality = format === 'webp' ? { quality: 85 } : {}
      const data = await takumi.renderAnimation({ scenes, ...box, fps, format, lang: settings.lang, images: page.images, ...quality })
      return { data: Buffer.from(data), width: box.width, height: box.height }
    },
  }
}

export type HtmlRenderer = ReturnType<typeof createHtmlRenderer>
