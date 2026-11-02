// Fake Swiftnest device hub for the devices e2e: two devices with
// device__<slug>__<capability> tools and the swiftnestDevices service.
// The laptop is online and is every session's current device; the phone is offline.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tm-testkit-swiftnest'
export const inject = ['tools']

const TOOLS = ['device__laptop__shell_run', 'device__laptop__screen_capture', 'device__pixel__screen_capture', 'device__pixel__notify_list']
const DEVICES = [
  { slug: 'laptop', name: 'EliteBook', kind: 'desktop', online: true },
  { slug: 'pixel', name: 'Pixel 8', kind: 'android', online: false, lastSeen: '2026-11-02T05:00:00Z' },
]

export function apply(ctx) {
  for (const toolName of TOOLS) {
    ctx.tools.register(defineTool({
      name: toolName,
      description: `Fake device tool ${toolName} for Tool Ultra tests.`,
      parameters: {},
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      async execute() { return toolName.startsWith('device__pixel__') ? 'device pixel is offline' : `ran ${toolName}` },
    }))
  }
  ctx.provide('swiftnestDevices', { list: () => DEVICES.map((d) => ({ ...d })), currentFor: () => 'laptop' })
}

export default { name, inject, apply }
