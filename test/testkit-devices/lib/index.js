// Test plugin for the attribution-scan e2e: phone, desktop and connector tools
// with no package.json declaration, so their category can only come from the
// rules (by the structural group name) — the case the scan's renaming broke.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tm-testkit-devices'
export const inject = ['tools']

const TOOLS = ['phone_dev_tap', 'phone_dev_swipe', 'desktop_dev_click', 'desktop_dev_key', 'mcp_connector_dev_status', 'mcp_connector_dev_list']

export function apply(ctx) {
  for (const toolName of TOOLS) {
    ctx.tools.register(defineTool({
      name: toolName,
      description: `Fake tool ${toolName} for dsh-tool-manager tests.`,
      parameters: {},
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      async execute() { return toolName },
    }))
  }
}

export default { name, inject, apply }
