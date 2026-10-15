// example-filter: narrow what one agent may see, without widening anything.
//
// A visibility filter runs last, after the core has computed the allowlist, and
// can only REMOVE names. It cannot add a tool the core hid, and it cannot hide
// the entry tools (`tools_ls` / `tools_load` / `tools_unload`) — otherwise the
// model could not get back to the directory.
//
// This example hides a list of tools for one agent, so a read-only bot never
// sees write-capable tools. The agent is matched by session id prefix, which is
// how a Bot's session is identified.

export const name = 'example-filter'
export const inject = ['toolCatalog']

export function apply(ctx, config = {}) {
  // { "<session id prefix>": ["tool_to_hide", ...] }
  const hiddenFor = config.hideFor ?? {}
  const fallback = config.hide ?? []

  ctx.effect(() => ctx.toolCatalog.registerVisibilityFilter({
    name: 'example:readonly-bot',
    filter(agent, names) {
      const sessionId = String(agent?.id ?? '')
      const entry = Object.entries(hiddenFor).find(([prefix]) => sessionId.startsWith(prefix))
      const hidden = new Set(entry ? entry[1] : fallback)
      if (hidden.size === 0) return names
      return names.filter((toolName) => !hidden.has(toolName))
    },
  }), 'example-filter.register()')
}

export default { name, inject, apply }
