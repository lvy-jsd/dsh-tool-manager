/**
 * Tool Ultra essentials pack: everyday tools that need no API key.
 *
 * - time_now, time_convert, date_diff: time zones and date math (Intl, no data files)
 * - math_eval: calculator with units and conversions (mathjs)
 * - weather_forecast: current weather and a daily forecast (Open-Meteo)
 * - geo_search: place and address lookup (OpenStreetMap Nominatim)
 * - wiki_search, wiki_summary: Wikipedia search and page summaries (Wikimedia REST)
 *
 * Tool names avoid DSH's built-in web_fetch / web_search.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { create, all } from 'mathjs'

export const name = 'tool-ultra-pack-essentials'
export const inject = ['tools']

export interface Config {
  /** Tool names to skip registering. */
  disable?: string[]
  /** User-Agent sent to public APIs (Nominatim and Wikimedia require one). */
  userAgent?: string
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Default Wikipedia language code. */
  wikiLang?: string
}

export const TOOL_NAMES = [
  'time_now',
  'time_convert',
  'date_diff',
  'math_eval',
  'weather_forecast',
  'geo_search',
  'wiki_search',
  'wiki_summary',
] as const

const DEFAULTS = {
  userAgent: 'dsh-tool-ultra (+https://github.com/lvy-jsd/dsh-tool-ultra)',
  timeoutMs: 10000,
  wikiLang: 'en',
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<any>
}>

// --- time helpers ------------------------------------------------------------------

function checkZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    throw new Error(`Unknown time zone "${tz}". Use an IANA name such as "Asia/Shanghai", "Europe/London" or "UTC".`)
  }
}

/** Offset of `tz` from UTC at instant `ms`, in minutes. */
export function zoneOffsetMinutes(tz: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)
}

function fmtOffset(min: number): string {
  const sign = min < 0 ? '-' : '+'
  const a = Math.abs(min)
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

/** ISO-like local time in `tz`, e.g. 2026-11-01T15:04:05+08:00 (Sunday). */
export function formatInZone(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    weekday: 'long',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}${fmtOffset(zoneOffsetMinutes(tz, ms))} (${g('weekday')})`
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/**
 * Parse a time string. Strings with an explicit offset or Z are absolute;
 * a bare "YYYY-MM-DD[ HH:MM[:SS]]" is read as wall-clock time in `tz`.
 */
export function parseTime(input: string, tz: string): number {
  const s = input.trim()
  if (s.toLowerCase() === 'now') return Date.now()
  const m = LOCAL_RE.exec(s)
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = m
    const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)
    // Two passes handle DST boundaries well enough for wall-clock input.
    let ms = guess - zoneOffsetMinutes(tz, guess) * 60000
    ms = guess - zoneOffsetMinutes(tz, ms) * 60000
    return ms
  }
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) throw new Error(`Cannot parse time "${input}". Use ISO 8601 such as "2026-11-01 15:30" or "2026-11-01T07:30:00Z".`)
  return ms
}

const UNIT_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60000,
  hours: 3600000,
  days: 86400000,
  weeks: 604800000,
}

// --- math --------------------------------------------------------------------------

/**
 * mathjs 15 raised the precedence of the unary percentage operator, so `50% + 10`
 * now parses as `50 % (+10)` (modulo) instead of `0.5 + 10`. That changes the answer
 * without any error, which is worse than refusing: find the changed nodes so the
 * tool can name the fix. A percentage that ends a term (`100 - 20%`) keeps its
 * meaning, and parentheses always restore it.
 */
function findChangedPercent(node: unknown, hits: string[] = []): string[] {
  if (!node || typeof node !== 'object') return hits
  if (Array.isArray(node)) {
    for (const child of node) findChangedPercent(child, hits)
    return hits
  }
  const n = node as { type?: string; op?: string; args?: unknown[]; toString?(): string }
  if (n.type === 'OperatorNode' && n.op === '%' && Array.isArray(n.args) && n.args.length === 2) {
    const right = n.args[1] as { type?: string; op?: string; args?: unknown[] }
    const signed = right?.type === 'OperatorNode' && (right.op === '+' || right.op === '-') && Array.isArray(right.args) && right.args.length === 1
    if (signed) hits.push(n.toString?.() ?? 'expression')
  }
  for (const child of Object.values(n)) findChangedPercent(child, hits)
  return hits
}

// --- weather -----------------------------------------------------------------------

const WMO: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'rime fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle', 56: 'freezing drizzle', 57: 'dense freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light showers', 81: 'showers', 82: 'violent showers', 85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail',
}
const wmo = (c: unknown) => WMO[Number(c)] ?? `code ${c}`

// --- factory -----------------------------------------------------------------------

export interface ToolSpec {
  name: (typeof TOOL_NAMES)[number]
  description: string
  parameters: Record<string, any>
  execute(args: any): Promise<string>
}

export interface CreateOptions extends Config {
  fetch?: FetchLike
}

/** Build the tool specs. Tests pass a mock `fetch`; `apply` wraps each with defineTool. */
export function createTools(opts: CreateOptions = {}): ToolSpec[] {
  const ua = opts.userAgent ?? DEFAULTS.userAgent
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const wikiLang = opts.wikiLang ?? DEFAULTS.wikiLang
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init as RequestInit))
  const math = create(all, {})
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  /** Refuse the expressions mathjs 15 would silently reinterpret; see findChangedPercent. */
  function rejectChangedPercent(expression: string): void {
    let tree: unknown
    try {
      tree = math.parse(expression)
    } catch {
      return // evaluate() reports syntax errors with its own wording.
    }
    const [hit] = findChangedPercent(tree)
    if (!hit) return
    throw new Error(
      `The % in "${hit}" is parsed as modulo since mathjs 15, not as a percentage. Write the percentage in parentheses — (50%) + 10 — or as a decimal, 0.5 + 10. For modulo with a signed operand, write 5 % (+2).`,
    )
  }

  async function getJson(url: string): Promise<any> {
    const signal = AbortSignal.timeout(timeoutMs)
    const res = await doFetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
    return res.json()
  }

  const langOf = (lang: unknown) => {
    const l = String(lang || wikiLang).toLowerCase()
    if (!/^[a-z][a-z0-9-]{1,15}$/.test(l)) throw new Error(`Bad language code "${lang}".`)
    return l
  }

  async function geocode(q: string): Promise<{ name: string; lat: number; lon: number; tz?: string }> {
    const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&name=${encodeURIComponent(q)}`)
    const r = data?.results?.[0]
    if (!r) throw new Error(`No place found for "${q}". Try a city name, or pass latitude and longitude.`)
    const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ')
    return { name: label, lat: r.latitude, lon: r.longitude, tz: r.timezone }
  }

  return [
    {
      name: 'time_now',
      description: 'Current date and time in a time zone (IANA name such as "Asia/Shanghai"; default is the host zone), with UTC offset and weekday.',
      parameters: {
        timezone: { type: 'string', description: 'IANA time zone, e.g. "America/New_York". Default: host zone.' },
      },
      async execute(args) {
        const tz = checkZone(args.timezone || localZone)
        const now = Date.now()
        return `${tz}: ${formatInZone(now, tz)}\nUTC: ${new Date(now).toISOString()}\nUnix: ${Math.floor(now / 1000)}`
      },
    },
    {
      name: 'time_convert',
      description: 'Convert a date/time from one time zone to another. A time without an offset is read as wall-clock time in from_tz.',
      parameters: {
        time: { type: 'string', required: true, description: 'ISO 8601 time ("2026-11-01 15:30", "2026-11-01T07:30Z") or "now".' },
        from_tz: { type: 'string', description: 'Zone of the input when it has no offset. Default: host zone.' },
        to_tz: { type: 'string', required: true, description: 'Target IANA zone.' },
      },
      async execute(args) {
        const from = checkZone(args.from_tz || localZone)
        const to = checkZone(args.to_tz)
        const ms = parseTime(args.time, from)
        return `${from}: ${formatInZone(ms, from)}\n${to}: ${formatInZone(ms, to)}`
      },
    },
    {
      name: 'date_diff',
      description: 'Time between two dates/times, as a breakdown and in one unit. Bare dates are read in the host zone.',
      parameters: {
        from: { type: 'string', required: true, description: 'Start, ISO 8601 or "now".' },
        to: { type: 'string', required: true, description: 'End, ISO 8601 or "now".' },
        unit: { type: 'string', enum: ['seconds', 'minutes', 'hours', 'days', 'weeks'], description: 'Unit for the single-number answer. Default: days.' },
      },
      async execute(args) {
        const a = parseTime(args.from, localZone)
        const b = parseTime(args.to, localZone)
        const diff = b - a
        const unit = args.unit || 'days'
        const abs = Math.abs(diff)
        const d = Math.floor(abs / 86400000)
        const h = Math.floor((abs % 86400000) / 3600000)
        const m = Math.floor((abs % 3600000) / 60000)
        const s = Math.floor((abs % 60000) / 1000)
        const val = Math.round((diff / UNIT_MS[unit]) * 1000) / 1000
        return `${diff < 0 ? '-' : ''}${d}d ${h}h ${m}m ${s}s\n= ${val} ${unit}`
      },
    },
    {
      name: 'math_eval',
      description: 'Evaluate a math expression exactly instead of guessing: arithmetic, functions (sqrt, log, sin), matrices, statistics (mean, std), and units with conversion ("5 km to mile", "100 degF to degC", "2 GiB to MB"). One expression per line shows each result; ending a line with ";" hides its result. Variables persist within one call.',
      parameters: {
        expression: { type: 'string', required: true, description: 'Expression(s), e.g. "12% * 3400", "sqrt(2)^2", "60 mph to km/h".' },
      },
      async execute(args) {
        const expr = String(args.expression)
        if (expr.length > 4000) throw new Error('Expression too long (max 4000 characters).')
        rejectChangedPercent(expr)
        const scope = new Map()
        const out = math.evaluate(expr, scope)
        const fmt = (v: unknown) => math.format(v as any, { precision: 14 })
        const results = (out && typeof out === 'object' && 'entries' in out && Array.isArray((out as any).entries))
          ? (out as any).entries
          : [out]
        return results.filter((v: unknown) => v !== undefined).map(fmt).join('\n') || '(no result)'
      },
    },
    {
      name: 'weather_forecast',
      description: 'Current weather and a daily forecast (up to 16 days) for a place name or coordinates. Data: Open-Meteo, no key.',
      parameters: {
        location: { type: 'string', description: 'City or place name, e.g. "Shenzhen". Use this or latitude/longitude.' },
        latitude: { type: 'number', description: 'Latitude in degrees.' },
        longitude: { type: 'number', description: 'Longitude in degrees.' },
        days: { type: 'integer', description: 'Forecast days, 1-16. Default 3.' },
      },
      async execute(args) {
        let place: { name: string; lat: number; lon: number }
        if (typeof args.latitude === 'number' && typeof args.longitude === 'number') {
          place = { name: `${args.latitude}, ${args.longitude}`, lat: args.latitude, lon: args.longitude }
        } else if (args.location) {
          place = await geocode(String(args.location))
        } else {
          throw new Error('Pass location, or latitude and longitude.')
        }
        const days = Math.min(16, Math.max(1, Math.trunc(args.days ?? 3)))
        const url = 'https://api.open-meteo.com/v1/forecast'
          + `?latitude=${place.lat}&longitude=${place.lon}&timezone=auto&forecast_days=${days}`
          + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation'
          + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max'
        const w = await getJson(url)
        const u = w.current_units ?? {}
        const c = w.current ?? {}
        const lines = [
          `${place.name} (${w.timezone ?? 'local time'})`,
          `Now (${c.time}): ${wmo(c.weather_code)}, ${c.temperature_2m}${u.temperature_2m ?? '°C'} (feels ${c.apparent_temperature}${u.apparent_temperature ?? '°C'}), humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} ${u.wind_speed_10m ?? 'km/h'}, precip ${c.precipitation} ${u.precipitation ?? 'mm'}`,
        ]
        const d = w.daily ?? {}
        for (let i = 0; i < (d.time?.length ?? 0); i++) {
          const pp = d.precipitation_probability_max?.[i]
          lines.push(`${d.time[i]}: ${wmo(d.weather_code?.[i])}, ${d.temperature_2m_min?.[i]}..${d.temperature_2m_max?.[i]}°C, rain ${d.precipitation_sum?.[i]} mm${pp != null ? ` (${pp}%)` : ''}, wind max ${d.wind_speed_10m_max?.[i]} km/h`)
        }
        return lines.join('\n')
      },
    },
    {
      name: 'geo_search',
      description: 'Look up places and addresses (OpenStreetMap Nominatim): coordinates, full address and type. Also reverse-geocodes when given "lat,lon".',
      parameters: {
        query: { type: 'string', required: true, description: 'Place, address or "lat,lon".' },
        limit: { type: 'integer', description: 'Max results, 1-10. Default 5.' },
      },
      async execute(args) {
        const q = String(args.query).trim()
        const limit = Math.min(10, Math.max(1, Math.trunc(args.limit ?? 5)))
        const rev = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q)
        const base = 'https://nominatim.openstreetmap.org'
        const data = rev
          ? [await getJson(`${base}/reverse?format=jsonv2&lat=${rev[1]}&lon=${rev[2]}`)]
          : await getJson(`${base}/search?format=jsonv2&limit=${limit}&q=${encodeURIComponent(q)}`)
        const rows = (Array.isArray(data) ? data : []).filter((r: any) => r && r.lat != null)
        if (!rows.length) return `No results for "${q}".`
        return rows.map((r: any, i: number) => `${i + 1}. ${r.display_name}\n   ${r.lat}, ${r.lon} · ${[r.category ?? r.class, r.type].filter(Boolean).join('/')}`).join('\n')
      },
    },
    {
      name: 'wiki_search',
      description: 'Search Wikipedia page titles and snippets in any language edition.',
      parameters: {
        query: { type: 'string', required: true, description: 'Search words.' },
        lang: { type: 'string', description: 'Language code such as "en", "zh", "ja". Default from config.' },
        limit: { type: 'integer', description: 'Max results, 1-20. Default 5.' },
      },
      async execute(args) {
        const lang = langOf(args.lang)
        const limit = Math.min(20, Math.max(1, Math.trunc(args.limit ?? 5)))
        const data = await getJson(`https://${lang}.wikipedia.org/w/rest.php/v1/search/page?limit=${limit}&q=${encodeURIComponent(String(args.query))}`)
        const pages = data?.pages ?? []
        if (!pages.length) return `No ${lang}.wikipedia.org pages for "${args.query}".`
        const strip = (s: string) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        return pages.map((p: any, i: number) => `${i + 1}. ${p.title}${p.description ? ` (${p.description})` : ''}\n   ${strip(p.excerpt)}`).join('\n')
      },
    },
    {
      name: 'wiki_summary',
      description: 'Summary (lead section) of one Wikipedia page by title, with its URL. Use wiki_search first if unsure of the exact title.',
      parameters: {
        title: { type: 'string', required: true, description: 'Exact page title, e.g. "Rust (programming language)".' },
        lang: { type: 'string', description: 'Language code. Default from config.' },
      },
      async execute(args) {
        const lang = langOf(args.lang)
        const t = encodeURIComponent(String(args.title).trim().replace(/ /g, '_'))
        const s = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${t}?redirect=true`)
        const url = s?.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${t}`
        const head = s?.type === 'disambiguation' ? `${s.title} is a disambiguation page; search for a more specific title.` : s?.title
        return [head, s?.description, '', s?.extract, '', url].filter((x) => x !== undefined && x !== null).join('\n').trim()
      },
    },
  ]
}

export function apply(ctx: any, config: Config = {}) {
  const disabled = new Set(config.disable ?? [])
  // List the pack in Tool Ultra's panel and make it loadable as pack:essentials.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['toolCatalog'], (c: any) => {
      if (typeof c.toolCatalog?.registerToolPack !== 'function') return
      c.effect(() => c.toolCatalog.registerToolPack({
        id: 'essentials',
        title: 'Essentials',
        summary: 'Time zones, date math, a calculator with units, weather, place search and Wikipedia. No API keys.',
        source: '@lvy-jsd/dsh-tool-ultra-pack-essentials',
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
