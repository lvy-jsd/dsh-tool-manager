/**
 * Tool Ultra web-reading pack.
 *
 * - web_read: fetch a page and return its main content as Markdown
 *   (Mozilla Readability on a linkedom DOM, then turndown).
 * - web_links: list the links on a page, optionally filtered.
 *
 * Names stay clear of DSH's built-in web_fetch / web_search. Private and
 * loopback addresses are refused unless `allowPrivate` is set, and every
 * redirect hop is checked again.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

export const name = 'tool-ultra-pack-web'
export const inject = ['tools']

export interface Config {
  disable?: string[]
  userAgent?: string
  timeoutMs?: number
  maxBytes?: number
  maxChars?: number
  allowPrivate?: boolean
}

export const TOOL_NAMES = ['web_read', 'web_links'] as const

const DEFAULTS = {
  userAgent: 'Mozilla/5.0 (compatible; dsh-tool-ultra; +https://github.com/lvy-jsd/dsh-tool-ultra)',
  timeoutMs: 15000,
  maxBytes: 5_000_000,
  maxChars: 20000,
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

export interface FetchResponse {
  status: number
  url?: string
  headers: { get(name: string): string | null }
  body?: ReadableStream<Uint8Array> | null
  text?(): Promise<string>
}
export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' }) => Promise<FetchResponse>
export type Resolver = (host: string) => Promise<string[]>

// --- address checks ----------------------------------------------------------------

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
  }
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (v === '::' || v === '::1') return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
  if (mapped) return isPrivateAddress(mapped[1])
  return /^(fc|fd|fe[89ab]|ff)/.test(v)
}

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address)

async function checkUrl(raw: string, allowPrivate: boolean, resolve: Resolver): Promise<URL> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error(`Not a URL: "${raw}". Pass a full http(s) address.`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Only http and https URLs are allowed, not ${u.protocol}`)
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed.')
  if (allowPrivate) return u
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error(`Refusing private address ${host} (set allowPrivate to permit).`)
  const addrs = isIP(host) ? [host] : await resolve(host)
  if (!addrs.length) throw new Error(`Cannot resolve ${host}.`)
  const bad = addrs.find(isPrivateAddress)
  if (bad) throw new Error(`Refusing private address ${host} -> ${bad} (set allowPrivate to permit).`)
  return u
}

async function readCapped(res: FetchResponse, maxBytes: number): Promise<string> {
  if (!res.body) return res.text ? (await res.text()).slice(0, maxBytes) : ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  if (total >= maxBytes) await reader.cancel().catch(() => {})
  const buf = new Uint8Array(Math.min(total, maxBytes))
  let off = 0
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.length - off)
    buf.set(c.subarray(0, take), off)
    off += take
    if (off >= buf.length) break
  }
  const charset = /charset=([^;]+)/i.exec(res.headers.get('content-type') ?? '')?.[1]?.trim().replace(/"/g, '')
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

// --- html -> markdown --------------------------------------------------------------

function turndown(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button'] as any)
  return td
}

function absolutize(doc: any, base: string) {
  for (const [sel, attr] of [['a[href]', 'href'], ['img[src]', 'src']] as const) {
    for (const el of doc.querySelectorAll(sel)) {
      try {
        el.setAttribute(attr, new URL(el.getAttribute(attr), base).href)
      } catch { /* leave as is */ }
    }
  }
}

export interface Extracted {
  title: string
  byline?: string
  siteName?: string
  published?: string
  markdown: string
}

/** Main content of an HTML page as Markdown; falls back to the whole body when Readability finds nothing. */
export function htmlToMarkdown(html: string, url: string): Extracted {
  const { document } = parseHTML(html)
  absolutize(document, url)
  const title = document.querySelector('title')?.textContent?.trim() ?? ''
  let article: ReturnType<Readability<string>['parse']> = null
  try {
    article = new Readability(document as any, { keepClasses: false }).parse()
  } catch {
    article = null
  }
  const td = turndown()
  if (article?.content) {
    return {
      title: article.title || title,
      byline: article.byline ?? undefined,
      siteName: article.siteName ?? undefined,
      published: article.publishedTime ?? undefined,
      markdown: td.turndown(article.content).trim(),
    }
  }
  // Readability mutates the DOM, so parse again for the fallback.
  const fresh = parseHTML(html).document
  absolutize(fresh, url)
  const body = fresh.querySelector('body')
  return { title, markdown: body ? td.turndown(body.innerHTML).trim() : '' }
}

// --- factory -----------------------------------------------------------------------

export interface ToolSpec {
  name: (typeof TOOL_NAMES)[number]
  description: string
  parameters: Record<string, any>
  execute(args: any): Promise<string>
}

export interface CreateOptions extends Config {
  fetch?: FetchLike
  resolve?: Resolver
}

export function createTools(opts: CreateOptions = {}): ToolSpec[] {
  const ua = opts.userAgent ?? DEFAULTS.userAgent
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes
  const defaultChars = opts.maxChars ?? DEFAULTS.maxChars
  const allowPrivate = opts.allowPrivate === true
  const resolve = opts.resolve ?? defaultResolver
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponse>)

  /** GET with manual redirects so each hop passes the address check. */
  async function get(raw: string): Promise<{ url: string; type: string; body: string }> {
    const signal = AbortSignal.timeout(timeoutMs)
    let url = (await checkUrl(raw, allowPrivate, resolve)).href
    for (let hop = 0; hop <= 5; hop++) {
      const res = await doFetch(url, {
        headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
        signal,
        redirect: 'manual',
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) throw new Error(`HTTP ${res.status} without a Location header from ${url}`)
        url = (await checkUrl(new URL(loc, url).href, allowPrivate, resolve)).href
        continue
      }
      if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${url}`)
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      return { url, type, body: await readCapped(res, maxBytes) }
    }
    throw new Error('Too many redirects.')
  }

  const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n\n[truncated: ${s.length - n} more characters; call again with a larger max_chars or offset]` : s)
  const clampChars = (n: unknown) => Math.min(200000, Math.max(500, Math.trunc(Number(n) || defaultChars)))

  return [
    {
      name: 'web_read',
      description: 'Read a web page as clean Markdown: fetches the URL, keeps the main article (drops menus, ads and footers), and returns title, author, date and text with absolute links. Plain-text and JSON responses are returned as-is. Use this instead of web_fetch when you want the readable content of an article, doc page or blog post.',
      parameters: {
        url: { type: 'string', required: true, description: 'http(s) URL.' },
        max_chars: { type: 'integer', description: 'Cap on returned characters (500-200000). Default from config, 20000.' },
        offset: { type: 'integer', description: 'Skip this many characters of the Markdown, to page through long documents.' },
        full_page: { type: 'boolean', description: 'Convert the whole body instead of only the main article.' },
      },
      async execute(args) {
        const { url, type, body } = await get(String(args.url))
        const max = clampChars(args.max_chars)
        const off = Math.max(0, Math.trunc(Number(args.offset) || 0))
        if (type && !type.includes('html') && !type.includes('xml')) {
          if (type.startsWith('text/') || type.includes('json')) return `URL: ${url}\nType: ${type}\n\n${cap(body.slice(off), max)}`
          throw new Error(`Unsupported content type ${type} at ${url}.`)
        }
        let ex: Extracted
        if (args.full_page) {
          const { document } = parseHTML(body)
          absolutize(document, url)
          ex = { title: document.querySelector('title')?.textContent?.trim() ?? '', markdown: turndown().turndown(document.querySelector('body')?.innerHTML ?? '').trim() }
        } else {
          ex = htmlToMarkdown(body, url)
        }
        const head = [
          `# ${ex.title || url}`,
          `URL: ${url}`,
          ex.byline && `By: ${ex.byline}`,
          ex.siteName && `Site: ${ex.siteName}`,
          ex.published && `Published: ${ex.published}`,
        ].filter(Boolean).join('\n')
        return `${head}\n\n${cap(ex.markdown.slice(off), max) || '(no readable text found; try full_page)'}`
      },
    },
    {
      name: 'web_links',
      description: 'List the links on a web page (text and absolute URL), optionally only those whose text or URL contains a filter word, or only links on the same site.',
      parameters: {
        url: { type: 'string', required: true, description: 'http(s) URL.' },
        filter: { type: 'string', description: 'Case-insensitive word that the link text or URL must contain.' },
        same_site: { type: 'boolean', description: 'Only links to the same host.' },
        limit: { type: 'integer', description: 'Max links, 1-500. Default 100.' },
      },
      async execute(args) {
        const { url, body } = await get(String(args.url))
        const { document } = parseHTML(body)
        const host = new URL(url).host
        const f = String(args.filter ?? '').toLowerCase()
        const limit = Math.min(500, Math.max(1, Math.trunc(args.limit ?? 100)))
        const seen = new Set<string>()
        const out: string[] = []
        for (const a of document.querySelectorAll('a[href]') as any) {
          let href: string
          try {
            const u = new URL(a.getAttribute('href'), url)
            if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
            u.hash = ''
            href = u.href
            if (args.same_site && u.host !== host) continue
          } catch {
            continue
          }
          const text = String(a.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (f && !text.toLowerCase().includes(f) && !href.toLowerCase().includes(f)) continue
          if (seen.has(href)) continue
          seen.add(href)
          out.push(`- [${text || href}](${href})`)
          if (out.length >= limit) break
        }
        return out.length ? `${out.length} link(s) on ${url}\n${out.join('\n')}` : `No matching links on ${url}.`
      },
    },
  ]
}

export function apply(ctx: any, config: Config = {}) {
  const disabled = new Set(config.disable ?? [])
  // List the pack in Tool Ultra's panel and make it loadable as pack:web.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['toolCatalog'], (c: any) => {
      if (typeof c.toolCatalog?.registerToolPack !== 'function') return
      c.effect(() => c.toolCatalog.registerToolPack({
        id: 'web',
        title: 'Web reading',
        summary: 'Read a page as clean Markdown and list its links. Private addresses are refused by default.',
        source: '@lvy-jsd/dsh-tool-ultra-pack-web',
        tools: TOOL_NAMES.filter((n) => !disabled.has(n)),
      }))
    })
  }
  for (const spec of createTools(config)) {
    if (disabled.has(spec.name)) continue
    ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      execute: (args: unknown) => spec.execute(args),
    } as any))
  }
}

export default { name, inject, apply }
