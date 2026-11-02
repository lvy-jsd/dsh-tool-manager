// dsh-tool-ultra-devices: the device namespace.
//
// Tools from phones and computers connected through Swiftnest carry a device
// slug in their name:
//
//   device__<slug>__<capability>          registered natively by Swiftnest
//   mcp__swiftnest__<slug>__<capability>  Swiftnest reached over MCP
//   mcp__devices__<slug>__<capability>    transitional MCP name of the first build
//
// This plugin files them under /device/<slug>, marks offline devices in
// tools_ls, and adds load targets:
//
//   device:current            the device the user is chatting from
//   device:all                every device
//   device:<slug>             one device
//   device:<who>/<capability> one capability, e.g. device:current/screen_capture
//
// The device list and the current device come from a DSH service (default
// `swiftnestDevices`) that the Swiftnest device hub provides. Without it the
// tools are still filed by name; device:current then reports that it is unknown.
//
// Approval of what a device actually does stays with the device hub. These
// tools are not marked high risk here, so loading them asks nothing extra.

import type { Agent, Disposer, ExtensionContext, Group } from '@lvy-jsd/dsh-tool-ultra-core'

export const name = 'tool-ultra-devices'
export const inject = ['toolCatalog']

export interface DeviceInfo {
  slug: string
  name?: string
  kind?: 'desktop' | 'android' | string
  online?: boolean
  lastSeen?: string
}

/** What the Swiftnest device hub provides inside DSH. */
export interface DeviceService {
  list(): DeviceInfo[]
  /** Slug of the device the user is chatting from in this session. */
  currentFor?(sessionId: string): string | undefined
}

export interface DevicesConfig {
  prefixes?: string[]
  service?: string
  changeEvent?: string
  /** For tests and other hosts: the service object itself. */
  devices?: DeviceService
}

export const CATEGORY = 'device'
const SLUG = '[a-z0-9_-]{1,24}'

/** Device slug and capability for a tool name, or undefined when it is not a device tool. */
export function parseDeviceTool(toolName: string, prefixes: readonly string[] = ['device__', 'mcp__swiftnest__', 'mcp__devices__']): { slug: string, capability: string } | undefined {
  for (const prefix of prefixes) {
    if (!toolName.startsWith(prefix)) continue
    const m = new RegExp(`^(${SLUG})__(.+)$`).exec(toolName.slice(prefix.length))
    if (m) return { slug: m[1], capability: m[2] }
  }
  return undefined
}

function sessionIdOf(agent: Agent | undefined): string | undefined {
  const id = agent?.session?.id ?? agent?.id
  return id === undefined || id === null || id === '' ? undefined : String(id)
}

type Ctx = ExtensionContext & { get?(name: string): unknown, emit?(event: string, ...args: unknown[]): void }

export function apply(ctx: Ctx, config: DevicesConfig = {}) {
  const logger = (typeof ctx.logger === 'function' ? (ctx.logger as (n: string) => any)('tool-ultra-devices') : ctx.logger) ?? console
  const prefixes = config.prefixes?.length ? config.prefixes : ['device__', 'mcp__swiftnest__', 'mcp__devices__']
  const serviceName = config.service ?? 'swiftnestDevices'
  const changeEvent = config.changeEvent ?? 'swiftnest/devices-changed'
  const catalog = ctx.toolCatalog

  const service = (): DeviceService | undefined => {
    if (config.devices) return config.devices
    try {
      const s = typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
      return s && typeof (s as DeviceService).list === 'function' ? (s as DeviceService) : undefined
    } catch {
      return undefined
    }
  }
  const devices = (): DeviceInfo[] => {
    try {
      return service()?.list() ?? []
    } catch (e) {
      logger.warn?.(`tool-ultra-devices: listing devices failed: ${(e as Error).message}`)
      return []
    }
  }

  // Filing: the slug is the group, every such group sits in /device.
  ctx.effect(() => catalog.registerClassifier({
    name,
    priority: 1000,
    group: (tool) => parseDeviceTool(tool.name, prefixes)?.slug,
    categorize: (group) => (group.tools.length > 0 && group.tools.every((t) => parseDeviceTool(t.name, prefixes)) ? CATEGORY : undefined),
  }), 'tool-ultra-devices.classifier()')

  // Offline and display-name notes in tools_ls.
  ctx.effect(() => catalog.registerGroupNote({
    name,
    note(group: Group) {
      if (group.category !== CATEGORY) return undefined
      const d = devices().find((x) => x.slug === group.name)
      if (!d) return undefined
      const label = d.name && d.name !== d.slug ? `${d.name}${d.kind ? `, ${d.kind}` : ''}` : d.kind
      const state = d.online === false ? `[offline${d.lastSeen ? `, last seen ${d.lastSeen}` : ''}]` : ''
      return [label ? `(${label})` : '', state].filter(Boolean).join(' ') || undefined
    },
  }), 'tool-ultra-devices.notes()')

  /** Tool names of one device, from the catalog. */
  const toolsOf = (slug: string, capability?: string): string[] => {
    const out: string[] = []
    for (const toolName of catalog.get().tools.keys()) {
      const p = parseDeviceTool(toolName, prefixes)
      if (p && p.slug === slug && (!capability || p.capability === capability)) out.push(toolName)
    }
    return out.sort()
  }
  const allSlugs = (): string[] => {
    const set = new Set<string>()
    for (const toolName of catalog.get().tools.keys()) {
      const p = parseDeviceTool(toolName, prefixes)
      if (p) set.add(p.slug)
    }
    return [...set].sort()
  }

  ctx.effect(() => catalog.registerTargetResolver({
    name,
    prefix: 'device:',
    resolve(target: string, agent?: Agent) {
      const rest = target.slice('device:'.length).trim()
      const [who, capability] = rest.split('/', 2).map((s) => s.trim())
      let slugs: string[]
      if (who === 'all' || who === '') slugs = allSlugs()
      else if (who === 'current') {
        const sid = sessionIdOf(agent)
        const slug = sid ? service()?.currentFor?.(sid) : undefined
        // An empty list reads as a miss in tools_load, which is what the model should see.
        if (!slug) return []
        slugs = [slug]
      } else slugs = [who.toLowerCase()]
      const names = slugs.flatMap((s) => toolsOf(s, capability || undefined))
      return names.length ? names : []
    },
  }), 'tool-ultra-devices.resolver()')

  // Rebuild the directory when devices come and go, so notes stay current.
  if (typeof ctx.on === 'function') {
    ctx.effect(() => ctx.on(changeEvent, () => catalog.refresh()) as Disposer, 'tool-ultra-devices.changes()')
  }

  if (typeof catalog.registerToolPack === 'function') {
    ctx.effect(() => catalog.registerToolPack({
      id: 'devices',
      title: 'Devices',
      summary: 'Tools of the phones and computers connected through Swiftnest. Load with device:current, device:all or device:<name>.',
      source: '@lvy-jsd/dsh-tool-ultra-devices',
      tools: prefixes.map((p) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${SLUG}__`)),
      items: () => devices().map((d) => ({
        id: d.slug,
        title: d.name ?? d.slug,
        state: d.online === false ? 'off' : 'on',
        detail: [d.kind, d.online === false ? `offline${d.lastSeen ? ` since ${d.lastSeen}` : ''}` : 'online'].filter(Boolean).join(' · '),
      })),
    }), 'tool-ultra-devices.pack()')
  }
}

export default { name, inject, apply }
