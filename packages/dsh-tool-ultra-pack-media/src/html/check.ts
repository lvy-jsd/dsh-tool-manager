/**
 * What HTML the renderer accepts, and the pictures it may show.
 *
 * The renderer never fetches anything and never runs scripts. The check makes
 * that explicit to the model with readable reasons, and it is an allowlist for
 * links: `#id`, inline base64 images, and image files that resolve (after
 * links) inside the output folder or an allowed input folder. Those files are
 * read here and handed to the renderer by name.
 */
import { readFile, stat } from 'node:fs/promises'
import { resolveInputFile, type InputFolders } from '../files.js'
import { findReferences, isSelfContained } from '../references.js'

export interface HtmlLimits {
  /** Largest HTML source accepted, in bytes. */
  maxHtmlBytes: number
  /** Largest picture file an HTML page may show, in bytes. */
  maxImageBytes: number
}

export interface PageImage {
  src: string
  data: Buffer
}

const FORBIDDEN = [
  { pattern: /<!ENTITY/i, reason: 'entities are not allowed' },
  {
    pattern: /<(script|iframe|frame|object|embed|link|meta|base|form)[\s>/]/i,
    reason: 'scripts, embedded pages, <link>, <meta> and forms are not supported. Put CSS in a <style> block and animate with CSS @keyframes',
  },
  { pattern: /@import/i, reason: 'CSS @import is not allowed' },
  { pattern: /@font-face/i, reason: 'web fonts are not allowed. Use font-family sans-serif, serif or monospace; Chinese and emoji are included' },
]
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i

function refuse(reason: string): never {
  throw new Error(`Refusing HTML: ${reason}.`)
}

/** Throws with a readable reason when the HTML uses something the renderer will not do. */
export function checkHtml(html: string, limits: HtmlLimits): string[] {
  if (!html.trim()) throw new Error('html is empty.')
  if (Buffer.byteLength(html, 'utf8') > limits.maxHtmlBytes) throw new Error(`HTML is larger than ${limits.maxHtmlBytes} bytes.`)
  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(html)) refuse(reason)
  }
  const files = findReferences(html).filter((reference) => !isSelfContained(reference))
  const bad = files.find((reference) => !IMAGE_FILE.test(reference) || /^[a-z][a-z0-9+.-]+:/i.test(reference))
  if (bad !== undefined) {
    refuse(`it links to "${bad.slice(0, 80)}". Pictures must be inline data:image/... or a .png/.jpg/.webp/.gif file from the output folder (by name) or an allowed input folder`)
  }
  return [...new Set(files)]
}

async function readImage(folders: InputFolders, reference: string, maxBytes: number): Promise<PageImage> {
  const path = await resolveInputFile(folders, reference)
  if ((await stat(path)).size > maxBytes) throw new Error(`Picture "${reference}" is larger than ${maxBytes} bytes.`)
  return { src: reference, data: await readFile(path) }
}

/** Checks the HTML and reads every picture file it shows. */
export async function preparePage(html: string, limits: HtmlLimits, folders: InputFolders): Promise<PageImage[]> {
  const files = checkHtml(html, limits)
  return Promise.all(files.map((reference) => readImage(folders, reference, limits.maxImageBytes)))
}
