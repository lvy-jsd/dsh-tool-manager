/**
 * Links inside markup the model wrote (SVG or HTML): every `src`, `href` and
 * CSS `url(...)`. The SVG and HTML checks both read them from here, so one
 * pattern decides what counts as a link.
 */

const ATTRIBUTE = /\b(?:xlink:href|href|srcset|src|poster)\s*=\s*(["'])([\s\S]*?)\1/gi
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi
const INLINE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,/i

/** Every link target in `markup`, trimmed, in order of appearance. */
export function findReferences(markup: string): string[] {
  const found: string[] = []
  for (const pattern of [ATTRIBUTE, CSS_URL]) {
    for (const match of markup.matchAll(pattern)) found.push(match[2].trim())
  }
  return found
}

/** A link that stays inside the document: `#id` or an inline base64 raster image. */
export function isSelfContained(reference: string): boolean {
  return reference.startsWith('#') || INLINE_IMAGE.test(reference)
}
