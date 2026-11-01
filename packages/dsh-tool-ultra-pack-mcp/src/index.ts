/**
 * Tool Ultra MCP preset pack.
 *
 * Starts well-known MCP servers through @deepseek-ai/dsh-mcp-client, one
 * child plugin per preset. Presets that need nothing start by default; those
 * that need a key or a setting wait until it is present. Each server's tools
 * appear as mcp__<preset>__<tool> and are placed in the Tool Ultra directory
 * under the preset's category, with write/delete tools marked high risk.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PRESETS, describePlan, planPresets, type PlanConfig, type PlannedPreset } from './presets.js'

export * from './presets.js'

export const name = 'tool-ultra-pack-mcp'
export const inject = ['tools']

export interface Config extends PlanConfig {
  /** Module that provides the MCP client plugin. */
  clientModule?: string
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

type Loader = (spec: string) => Promise<any>

/** Tool Ultra annotations for every preset, whether or not it is on. */
export function presetAnnotations(): { match: RegExp; meta: Record<string, string> }[] {
  const out: { match: RegExp; meta: Record<string, string> }[] = []
  for (const p of PRESETS) {
    out.push({ match: new RegExp(`^mcp__${p.id}__`), meta: { group: p.id, category: p.category } })
    if (p.highRisk) out.push({ match: new RegExp(`^mcp__${p.id}__(?:${p.highRisk.replace(/^\^/, '')})`), meta: { risk: 'high' } })
  }
  return out
}

/** Per-preset status in the shape Tool Ultra's panel shows. */
export function packItems(plan: PlannedPreset[], errors: Record<string, string> = {}) {
  return plan.map(({ preset, status, missing }) => {
    const error = errors[preset.id]
    const state = error ? 'failed' : status === 'needs-key' ? 'waiting' : status
    const detail = error ?? (status === 'needs-key' ? `needs ${missing.map((m) => `${m.env} (${m.hint})`).join(', ')}` : preset.summary)
    return { id: preset.id, title: preset.title, state, detail }
  })
}

export function apply(ctx: any, config: Config = {}, load: Loader = (s) => import(s)) {
  // DSH passes a logger object; a plain cordis context passes a factory.
  const logger = (typeof ctx.logger === 'function' ? ctx.logger('tool-ultra-pack-mcp') : ctx.logger) ?? console
  const plan: PlannedPreset[] = planPresets(config)
  const errors: Record<string, string> = {}

  // Directory placement, once Tool Ultra's service is up.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['toolCatalog'], (c: any) => {
      for (const { match, meta } of presetAnnotations()) c.effect(() => c.toolCatalog.annotate(match, meta))
      if (typeof c.toolCatalog.registerToolPack === 'function') {
        c.effect(() => c.toolCatalog.registerToolPack({
          id: 'mcp',
          title: 'MCP presets',
          summary: 'Well-known MCP servers started through DSH\'s MCP client. Keyless presets run by default; the rest start once their key is set.',
          source: '@lvy-jsd/dsh-tool-ultra-pack-mcp',
          tools: ['mcp_presets', ...plan.filter((p) => p.status === 'on').map((p) => new RegExp(`^mcp__${p.preset.id}__`))],
          items: () => packItems(plan, errors),
        }))
      }
    })
  }

  const on = plan.filter((p) => p.status === 'on')
  for (const p of plan) {
    if (p.status === 'needs-key') logger.info?.(`preset ${p.preset.id} waits for ${p.missing.map((m) => m.env).join(', ')}`)
  }
  if (on.length) {
    const spec = config.clientModule ?? '@deepseek-ai/dsh-mcp-client'
    const started = load(spec).then((mod) => {
      const client = mod?.default ?? mod
      for (const p of on) {
        try {
          const fiber = ctx.plugin(client, p.client)
          // A failed connection must not take the pack or its siblings down.
          Promise.resolve(fiber).catch((e: Error) => {
            errors[p.preset.id] = e?.message ?? String(e)
            logger.warn?.(`preset ${p.preset.id} failed to start: ${errors[p.preset.id]}`)
          })
        } catch (e) {
          errors[p.preset.id] = (e as Error).message
          logger.warn?.(`preset ${p.preset.id} failed to start: ${errors[p.preset.id]}`)
        }
      }
    }, (e: Error) => {
      for (const p of on) errors[p.preset.id] = `${spec} is not installed (${e.message})`
      logger.warn?.(`${spec} could not be loaded, so no MCP preset starts: ${e.message}`)
    })
    void started
  }

  ctx.tools.register(defineTool({
    name: 'mcp_presets',
    description: 'List the bundled MCP server presets (memory, browser, GitHub, search, maps and more): which are running, which are waiting for an API key or setting and where to get it. Running presets expose tools named mcp__<preset>__*; load them with tools_load(["/<category>/<preset>"]).',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute() {
      return describePlan(plan, errors)
    },
  }))
}

export default { name, inject, apply }
