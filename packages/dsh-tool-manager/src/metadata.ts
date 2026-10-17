// Persisted tool metadata for dsh-tool-manager.
//
// A package declares its tools in package.json (`dsh.toolCatalog`), which a user
// cannot edit from the browser. This file holds the same kind of metadata keyed
// by tool name, written by the panel, and is applied after every other
// annotation so an edit always wins over the declaration it corrects.
//
// Only metadata is stored here. A tool's parameters and description belong to
// the host and its plugins; rewriting them for the model is not something a
// directory plugin can do, and pretending otherwise would drift from what the
// model actually receives.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Annotation, Logger, ToolMeta } from './types.js'

const META_KEYS = ['group', 'category', 'risk', 'summary'] as const

/** Where edited metadata is stored unless a deployment points elsewhere. */
export function defaultMetadataFile(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.config', 'deepseek-harness')
  return join(dshHome, 'tool-manager', 'metadata.json')
}

/** Keep only known string fields; a blank value means "no override here". */
export function pickMeta(raw: unknown): ToolMeta {
  const out: ToolMeta = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const key of META_KEYS) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) out[key] = value.trim()
  }
  return out
}

/** The whole file: tool name -> metadata. Unknown shapes are dropped. */
export function pickMetadata(raw: unknown): Record<string, ToolMeta> {
  const out: Record<string, ToolMeta> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [name, meta] of Object.entries(raw as Record<string, unknown>)) {
    const picked = pickMeta(meta)
    if (name && Object.keys(picked).length) out[name] = picked
  }
  return out
}

/** Read the metadata file; missing or corrupt is "no overrides", never a crash. */
export function readMetadataFile(file: string, logger?: Logger): Record<string, ToolMeta> {
  try {
    return pickMetadata(JSON.parse(readFileSync(file, 'utf8')))
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException
    // ENOENT is the normal first run: no file means nothing has been edited.
    if (error.code !== 'ENOENT') logger?.warn?.(`tool-manager: ignoring unreadable metadata ${file}: ${error.message}`)
    return {}
  }
}

/** Write the file atomically, so a crash cannot leave a half-written override. */
export function writeMetadataFile(file: string, entries: Record<string, ToolMeta>, logger?: Logger): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`)
    renameSync(tmp, file)
  } catch (caught) {
    logger?.warn?.(`tool-manager: writing metadata ${file} failed: ${(caught as Error).message}`)
    throw caught
  }
}

export interface MetadataStore {
  /** File the store reads and writes. */
  file: string
  /** Every override, keyed by tool name. */
  all(): Record<string, ToolMeta>
  /** The override for one tool, or undefined. */
  get(name: string): ToolMeta | undefined
  /**
   * Replace the override for one tool. Fields left out are dropped rather than
   * kept, because the panel editor submits the whole form: an emptied field
   * must fall back to the package declaration, not silently keep its old value.
   * An empty result removes the override.
   */
  set(name: string, meta: ToolMeta): ToolMeta | undefined
  /** Drop the override for one tool. */
  clear(name: string): void
  /** Re-read the file, for after an external edit. */
  reload(): Record<string, ToolMeta>
  /** The overrides as annotations, for buildCatalog(). */
  annotations(): Annotation[]
}

/** Metadata store over one file. */
export function createMetadataStore({ file, logger }: { file: string, logger?: Logger }): MetadataStore {
  let entries = readMetadataFile(file, logger)
  return {
    file,
    all: () => ({ ...entries }),
    get: (name) => entries[name],
    set(name, meta) {
      const picked = pickMeta(meta)
      // A blank form is how the UI removes an override: leaving an empty object
      // behind would shadow nothing while still showing up as "edited".
      if (Object.keys(picked).length) entries[name] = picked
      else delete entries[name]
      writeMetadataFile(file, entries, logger)
      return entries[name]
    },
    clear(name) {
      delete entries[name]
      writeMetadataFile(file, entries, logger)
    },
    reload() {
      entries = readMetadataFile(file, logger)
      return { ...entries }
    },
    annotations() {
      return Object.entries(entries).map(([name, meta]) => ({ source: 'tool-manager:metadata', match: name, meta }))
    },
  }
}
