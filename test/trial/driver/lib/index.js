// Trial-only driver: starts one web-style session (agent preset mounted, like
// a session opened in the DSH web UI) through the host webhook runtime, and
// installs a global guard that refuses every tool except an allowlist.
//
// config: { workspacePath, prompt, agentPreset, permissionPreset, model: {provider, model}, allow, delayMs }
export const name = 'tm-trial-driver'
export const inject = ['tools', 'webhookRuntime']

export function apply(ctx, config) {
  const allow = new RegExp(config.allow ?? '^(tools_ls|tools_load|tools_unload)$')
  ctx.effect(() => ctx.tools.guard((exec) => (allow.test(exec.name) ? undefined : `trial guard: ${exec.name} is not allowed in this trial`)), 'trial.guard')

  ctx.effect(() => ctx.webhookRuntime.register({
    id: 'tm-trial',
    kind: 'tm-trial',
    async run() {
      return {
        workspacePath: config.workspacePath,
        title: 'tool-manager trial',
        prompt: config.prompt,
        agentPreset: config.agentPreset,
        permissionPreset: config.permissionPreset ?? 'read-only',
        ...(config.model ? { model: config.model } : {}),
      }
    },
  }), 'trial.rule')

  const timer = setTimeout(() => {
    ctx.webhookRuntime.dispatch({ kind: 'tm-trial', source: 'trial', deliveryId: `d-${Date.now()}`, receivedAt: Date.now(), payload: {} })
  }, config.delayMs ?? 3000)
  ctx.effect(() => () => clearTimeout(timer), 'trial.timer')
}

export default { name, inject, apply }
