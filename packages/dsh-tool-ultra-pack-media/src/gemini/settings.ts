import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// https://ai.google.dev/gemini-api/docs/models → Gemini 3.8 Flash: Stable.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
export const DEFAULT_GEMINI_KEY_FILE = '~/.config/swiftnest/gemini.key'

export interface GeminiSettings {
  apiKey?: string
  keyFile: string
  model: string
}

/** Read on each call so key rotation does not need a restart. Only a missing file is ignored. */
export async function resolveGeminiKey(settings: GeminiSettings): Promise<string | undefined> {
  const configured = settings.apiKey?.trim()
  if (configured) return configured
  const path = settings.keyFile.startsWith('~/') ? join(homedir(), settings.keyFile.slice(2)) : settings.keyFile
  try {
    const stored = (await readFile(path, 'utf8')).trim()
    if (stored) return stored
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('keyFile')
  }
  return process.env.GEMINI_API_KEY?.trim() || undefined
}

/** Also covers keys echoed in a URL by a server or a model. */
export function redactKey(text: string, key: string | undefined): string {
  if (!key) return text
  return [...new Set([key, encodeURIComponent(key)])].reduce((safe, secret) => safe.split(secret).join('[redacted]'), text)
}
