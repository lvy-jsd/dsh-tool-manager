/**
 * Where generated files go. Tools never take a path from the model: every
 * file is written into the one configured folder, under a cleaned-up name,
 * and an existing file is never overwritten.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_OUTPUT_DIR = join(homedir(), 'dsh-creations')

/** Letters, digits, `-` and `_` from the hint, at most 40 characters. */
export function safeBaseName(hint: unknown, fallback: string): string {
  const cleaned = String(hint ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || fallback
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

/** Writes `data` to `<dir>/<name>-<timestamp>[-n].<ext>` and returns the path. */
export async function saveFile(dir: string, name: string, ext: string, data: Buffer, now = new Date()): Promise<string> {
  await mkdir(dir, { recursive: true })
  const stem = `${name}-${timestamp(now)}`
  for (let n = 1; n <= 100; n++) {
    const path = join(dir, `${n === 1 ? stem : `${stem}-${n}`}.${ext}`)
    try {
      await writeFile(path, data, { flag: 'wx' })
      return path
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  throw new Error(`Could not find a free file name for ${stem}.${ext} in ${dir}.`)
}
