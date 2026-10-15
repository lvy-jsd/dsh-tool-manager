// dsh-tool-manager-persist: keep loaded tools across a DSH restart.
//
// Without this plugin, loaded state lives in memory only: restarting DSH loses
// it and the model has to walk the directory again. This plugin registers a
// state provider on `toolCatalog`, writing one small JSON file per session and
// reading it back when the session is adopted again (resume or fork).
//
// Files are per session id, in <DSH_HOME>/tool-manager/sessions/<id>.json:
//
//   { "loaded": [...], "groups": [...], "excluded": [...],
//     "handoffGroups": [...], "handoffTools": [...] }
//
// Group subscriptions are stored by name, so a group that gains tools later
// (an MCP server reconnecting) restores with the new tools included.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'tool-manager-persist'
export const inject = ['toolCatalog']

export function defaultDir() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.config', 'deepseek-harness')
  return join(dshHome, 'tool-manager', 'sessions')
}

const fileNameOf = (dir, agent) => (agent?.id ? join(dir, encodeURIComponent(agent.id)) + '.json' : null)

export function apply(ctx, config = {}) {
  const logger = (typeof ctx.logger === 'function' ? ctx.logger('tool-manager-persist') : ctx.logger) ?? console
  if (config.enabled === false) return
  const dir = config.dir ?? defaultDir()
  const write = config.write !== false

  function load(agent) {
    const file = fileNameOf(dir, agent)
    if (!file) return null
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      // ENOENT is the normal case (a session that never loaded anything).
      if (error.code !== 'ENOENT') logger.warn?.(`tool-manager-persist: reading ${file} failed: ${error.message}`)
      return null
    }
  }

  function save(agent, state) {
    const file = fileNameOf(dir, agent)
    if (!file || !write) return
    const empty = Object.values(state ?? {}).every((list) => !list?.length)
    try {
      if (empty) {
        // Nothing loaded: drop the file instead of keeping an empty record.
        rmSync(file, { force: true })
        return
      }
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, JSON.stringify(state, null, 2))
    } catch (error) {
      logger.warn?.(`tool-manager-persist: writing ${file} failed: ${error.message}`)
    }
  }

  ctx.effect(() => ctx.toolCatalog.registerStateProvider({ name: 'persist', load, save }), 'tool-manager-persist.provider()')

  return {
    dir,
    /** Delete the saved state of one session (used when a session is closed). */
    clear(agent) {
      const file = fileNameOf(dir, agent)
      if (file) rmSync(file, { force: true })
    },
  }
}

export default { name, inject, apply }
