// Test-only: reproduce a preset layer in the headless profile.
//
// The headless runner does not compose agent presets, but a preset is only
// this: a scope whose layer holds tools, bound as the agent's parent scope.
// This module does exactly what the preset registry does (createScope +
// bindScopeParent), so the core sees tools that exist only in an ancestor
// layer of the agent, not in the host's global layer.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createScope, bindScopeParent, scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope'

const TEXT = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] }

export function simulatePresetLayer(ctx, names = ['preset_only_ping', 'preset_only_echo']) {
  const presetKey = { name: 'tm-testkit-preset' }
  const preset = createScope(ctx, presetKey)
  for (const n of names) {
    preset.ctx.tools.register(defineTool({
      name: n,
      description: `Preset-layer tool ${n} for dsh-tool-manager tests.`,
      parameters: { text: { type: 'string' } },
      output: TEXT,
      async execute(args) { return `${n}:${args.text ?? ''}` },
    }))
  }
  ctx.inject(['agents'], (agentCtx) => {
    agentCtx.on('agent/created', ({ agent }) => {
      const key = scopeOf(agent.ctx) ?? agent
      if (scopeParentOf(key) === undefined) bindScopeParent(key, presetKey)
    })
  })
}
