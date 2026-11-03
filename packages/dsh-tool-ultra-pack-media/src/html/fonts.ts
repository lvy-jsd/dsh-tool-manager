/**
 * Fonts for the HTML renderer. Files named in the config come first; then the
 * host's own fonts, found with fontconfig (`fc-match`), so Chinese, serif,
 * monospace and colour emoji work without setup where those fonts are installed.
 */
import { execFile } from 'node:child_process'

export type GenericFamily = 'sans-serif' | 'serif' | 'monospace' | 'emoji'

export interface FontFile {
  path: string
  /** The CSS generic family this file answers for, when it is the first of its kind. */
  generic?: GenericFamily
}

/** fontconfig patterns, in fallback order: Chinese sans first, so plain text uses it. */
const WANTED: { pattern: string; generic?: GenericFamily }[] = [
  { pattern: 'sans-serif:lang=zh-cn', generic: 'sans-serif' },
  { pattern: 'sans-serif:lang=zh-cn:weight=bold' },
  { pattern: 'serif:lang=zh-cn', generic: 'serif' },
  { pattern: 'serif:lang=zh-cn:weight=bold' },
  { pattern: 'monospace', generic: 'monospace' },
  { pattern: 'emoji', generic: 'emoji' },
]

export type FindFont = (pattern: string) => Promise<string | undefined>

/** Asks fontconfig for the best file for `pattern`; undefined when fontconfig is missing. */
export const fcMatch: FindFont = (pattern) => new Promise((resolve) => {
  execFile('fc-match', ['-f', '%{file}', pattern], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
    resolve(error ? undefined : String(stdout).trim() || undefined)
  })
})

/** The configured files, then each wanted host font once. */
export async function chooseFonts(configured: string[], find: FindFont = fcMatch): Promise<FontFile[]> {
  const chosen: FontFile[] = configured.map((path) => ({ path }))
  const seen = new Set(configured)
  for (const { pattern, generic } of WANTED) {
    const path = await find(pattern)
    if (!path || seen.has(path)) continue
    seen.add(path)
    chosen.push({ path, generic })
  }
  return chosen
}
