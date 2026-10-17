// File-based exemption list for dsh-tool-manager.
//
// An exempt session is never narrowed: a route whose tool list is handed to an
// external client once at session start (Claude Code, say) cannot load a tool
// that was hidden from the first request, so hiding anything there only loses
// tools. The provider list originally came from `exemptProviders` in
// cordis.patch.yml, which a user cannot edit from the browser and which is
// awkward to change per session.
//
// This file replaces it: when <DSH_HOME>/tool-manager/exempt.json exists it wins
// over the plugin config, the same way the settings file does. Two entry forms
// are supported, because they answer different questions:
//
//   { "providers": ["claude-code"], "sessions": ["s_abc123"] }
//
//   providers  model routes never narrowed, for every session (durable)
//   sessions   one session exempted for its remaining lifetime, e.g. while the
//              user checks whether a client handles lazy loading (temporary)
//
// Sessions are matched against the agent's session id and, as a fallback, the
// agent id, so an entry can be removed by hand without knowing which of the two
// the host populated.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Logger } from './types.js'

/** An exemption list: routes and sessions. Both may be empty. */
export interface ExemptConfig {
  providers: string[]
  sessions: string[]
}

/** Where the exemption file lives unless a deployment points elsewhere. */
export function defaultExemptFile(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.config', 'deepseek-harness')
  return join(dshHome, 'tool-manager', 'exempt.json')
}

/** Keep only non-empty strings; a number or object in the file is a typo, not a name. */
function pickNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((name): name is string => typeof name === 'string' && name.trim().length > 0).map((name) => name.trim())
}

/** The whole file, with unknown keys dropped. */
export function pickExempt(raw: unknown): ExemptConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { providers: [], sessions: [] }
  const record = raw as Record<string, unknown>
  // `providers` is required: a file that omits it says "no route is exempt",
  // not "keep the old config list", because the file is the override.
  return { providers: pickNames(record.providers), sessions: pickNames(record.sessions) }
}

/** Read the exemption file; missing or corrupt is "no opinion", never a crash. */
export function readExemptFile(file: string, logger?: Logger): ExemptConfig | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException
    // ENOENT is the normal first run: no file means the plugin config decides.
    if (error.code !== 'ENOENT') logger?.warn?.(`tool-manager: ignoring unreadable exemptions ${file}: ${error.message}`)
    return undefined
  }
  try {
    return pickExempt(JSON.parse(text))
  } catch (caught) {
    // A corrupt file must not silently restore the config list: the user
    // intended the file to be in charge, so report and treat it as "no exempt".
    logger?.warn?.(`tool-manager: unreadable exemptions ${file}: ${(caught as Error).message}`)
    return { providers: [], sessions: [] }
  }
}

/** Write the file atomically, so a crash cannot leave a half-written list. */
export function writeExemptFile(file: string, config: ExemptConfig, logger?: Logger): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify({ providers: config.providers, sessions: config.sessions }, null, 2)}\n`)
    renameSync(tmp, file)
  } catch (caught) {
    logger?.warn?.(`tool-manager: writing exemptions ${file} failed: ${(caught as Error).message}`)
    throw caught
  }
}

/** Why a session is exempt, for the panel to show. */
export interface ExemptReason {
  exempt: boolean
  /** 'file:provider' | 'file:session' | 'config:provider' | '' */
  source: string
}

export interface ExemptStore {
  /** File the store reads and writes; the file itself is the override switch. */
  file: string
  /** True when the file exists, so the config provider list is ignored. */
  present(): boolean
  /** The lists in force: the file when it exists, else the plugin config. */
  effective(): ExemptConfig
  /** Why one session is exempt, if it is. */
  reasonFor(provider: string | undefined, sessionId: string | undefined): ExemptReason
  /** Add or remove one session, writing the file. Returns the lists in force. */
  setSession(sessionId: string, exempt: boolean): ExemptConfig
  /** Re-read the file, for after an external edit. Returns the lists in force. */
  reload(): ExemptConfig
}

/**
 * Exemption store over one file, with the plugin config as the fallback layer.
 * The file wins as a whole rather than per key: an operator writing the file
 * means it, and a partial merge would leave entries they cannot see.
 */
export function createExemptStore({ file, configProviders = [], logger }: { file: string, configProviders?: readonly string[], logger?: Logger }): ExemptStore {
  let fromFile = readExemptFile(file, logger)
  const effective = (): ExemptConfig => fromFile ?? { providers: [...configProviders], sessions: [] }
  return {
    file,
    present: () => fromFile !== undefined,
    effective,
    reasonFor(provider, sessionId) {
      const current = effective()
      if (provider !== undefined && current.providers.includes(provider)) {
        return { exempt: true, source: fromFile !== undefined ? 'file:provider' : 'config:provider' }
      }
      if (sessionId !== undefined && current.sessions.includes(sessionId)) return { exempt: true, source: 'file:session' }
      return { exempt: false, source: '' }
    },
    setSession(sessionId, exempt) {
      // Editing starts from what is in force, so the first panel click writes a
      // file that keeps the exemptions the user could already see.
      const current = effective()
      const sessions = new Set(current.sessions)
      if (exempt) sessions.add(sessionId)
      else sessions.delete(sessionId)
      fromFile = { providers: [...current.providers], sessions: [...sessions] }
      writeExemptFile(file, fromFile, logger)
      return effective()
    },
    reload() {
      fromFile = readExemptFile(file, logger)
      return effective()
    },
  }
}
