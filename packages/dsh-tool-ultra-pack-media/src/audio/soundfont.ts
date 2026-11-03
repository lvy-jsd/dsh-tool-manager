/**
 * The SoundFont music_render plays with: real recorded instrument samples
 * for every General MIDI instrument. A file named in the config is used as
 * it is; otherwise the default (FluidR3 Mono GM, MIT licence, about 24 MB)
 * downloads once into the model cache and is checked against its SHA-256.
 */
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { download, fetchVerified, writeAtomically, type Download } from '../download.js'

export const DEFAULT_SOUNDFONT = {
  url: 'https://raw.githubusercontent.com/musescore/MuseScore/3.x/share/sound/FluidR3Mono_GM.sf3',
  sha256: '2aacd036d7058d40a371846ef2f5dc5f130d648ab3837fe2626591ba49a71254',
  title: 'FluidR3 Mono GM',
}
const MAX_DOWNLOAD_BYTES = 300_000_000

export interface SoundFontSettings {
  /** A local .sf2 / .sf3 file to use instead of the default. */
  file?: string
  /** Where the default downloads from; a mirror of the same file also works. */
  url: string
  cacheDir: string
}

export interface SoundFont {
  bytes: Buffer
  title: string
}

async function fetchAndCache(settings: SoundFontSettings, path: string, fetchBytes: Download): Promise<Buffer> {
  const bytes = await fetchVerified(settings.url, DEFAULT_SOUNDFONT.sha256, MAX_DOWNLOAD_BYTES, fetchBytes).catch((error) => {
    throw new Error(`Could not download the SoundFont from ${settings.url} (${error.message}). Set soundfontUrl to a mirror, or soundfont to a local .sf2/.sf3 file.`)
  })
  await writeAtomically(path, bytes)
  return bytes
}

/** The configured SoundFont, or the default from the cache, downloading it on first use. */
export async function loadSoundFont(settings: SoundFontSettings, fetchBytes: Download = download): Promise<SoundFont> {
  if (settings.file) return { bytes: await readFile(settings.file), title: basename(settings.file) }
  const path = join(settings.cacheDir, 'soundfonts', basename(DEFAULT_SOUNDFONT.url))
  const cached = await readFile(path).catch(() => undefined)
  return { bytes: cached ?? (await fetchAndCache(settings, path, fetchBytes)), title: DEFAULT_SOUNDFONT.title }
}
