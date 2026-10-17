// Persisted settings for dsh-tool-manager.
//
// The panel (and any other UI) edits these instead of `cordis.patch.yml`, which
// a user cannot reach from the browser. The file lives beside the other state
// in <DSH_HOME>/tool-manager/config.json, so backing up or wiping that one
// directory covers everything this plugin persists.
//
// Priority: the file wins per key, the plugin config fills the keys it omits.
// A key present in the file as an empty array therefore clears the config value
// — that is how a UI removes an entry for good.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Logger, ToolManagerSettings } from './types.js'

const KEYS = ['pinned', 'unpin', 'highRisk'] as const

/** Where the panel writes settings unless a deployment points elsewhere. */
export function defaultSettingsFile(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.config', 'deepseek-harness')
  return join(dshHome, 'tool-manager', 'config.json')
}

/**
 * Keep only known keys holding arrays of non-empty strings. Unknown keys and
 * wrong types are dropped rather than trusted: the file may have been hand
 * edited, and a bad value must not reach the catalog.
 */
export function pickSettings(raw: unknown): ToolManagerSettings {
  const out: ToolManagerSettings = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const key of KEYS) {
    const value = (raw as Record<string, unknown>)[key]
    // Non-string entries are dropped, not coerced: a number is a typo, not a name.
    if (Array.isArray(value)) out[key] = value.filter((name): name is string => typeof name === 'string' && name.length > 0)
  }
  return out
}

/** Read the settings file; missing or corrupt is "no override", never a crash. */
export function readSettingsFile(file: string, logger?: Logger): ToolManagerSettings {
  try {
    return pickSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException
    // ENOENT is the normal first run: no file means "use the plugin config".
    if (error.code !== 'ENOENT') logger?.warn?.(`tool-manager: ignoring unreadable settings ${file}: ${error.message}`)
    return {}
  }
}

/** Write the file atomically, so a crash cannot leave a half-written override. */
export function writeSettingsFile(file: string, settings: ToolManagerSettings, logger?: Logger): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`)
    renameSync(tmp, file)
  } catch (caught) {
    // Callers report the failure to the UI, so let it through after logging.
    logger?.warn?.(`tool-manager: writing settings ${file} failed: ${(caught as Error).message}`)
    throw caught
  }
}

export interface SettingsStore {
  /** File the store reads and writes. */
  file: string
  /** Values read from the file, before the config fallback fills gaps. */
  stored(): ToolManagerSettings
  /** Effective values: the file wins per key, the config fills the rest. */
  effective(): Required<ToolManagerSettings>
  /** Merge a patch, persist it, and return the new effective values. */
  update(patch: ToolManagerSettings): Required<ToolManagerSettings>
  /** Re-read the file, for after an external edit. */
  reload(): Required<ToolManagerSettings>
}

/** Settings store over one file, with the plugin config as the fallback layer. */
export function createSettingsStore({ file, base, logger }: { file: string, base?: ToolManagerSettings, logger?: Logger }): SettingsStore {
  const fallback: Required<ToolManagerSettings> = {
    pinned: base?.pinned ?? [],
    unpin: base?.unpin ?? [],
    highRisk: base?.highRisk ?? [],
  }
  let stored = readSettingsFile(file, logger)
  const effective = (): Required<ToolManagerSettings> => ({
    pinned: stored.pinned ?? fallback.pinned,
    unpin: stored.unpin ?? fallback.unpin,
    highRisk: stored.highRisk ?? fallback.highRisk,
  })
  return {
    file,
    stored: () => ({ ...stored }),
    effective,
    update(patch) {
      // Merged, not replaced: a UI saving one list must not drop the others.
      stored = { ...stored, ...pickSettings(patch) }
      writeSettingsFile(file, stored, logger)
      return effective()
    },
    reload() {
      stored = readSettingsFile(file, logger)
      return effective()
    },
  }
}
