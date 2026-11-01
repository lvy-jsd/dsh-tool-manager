// Essentials pack: pure tools run as-is; network tools run against a mocked fetch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTools, apply, TOOL_NAMES, parseTime, formatInZone } from '../../packages/dsh-tool-ultra-pack-essentials/lib/index.js'

function mockFetch(routes) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    for (const [match, body] of routes) {
      if (url.includes(match)) return { ok: true, status: 200, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { fetch, calls }
}
const tool = (tools, n) => tools.find((t) => t.name === n)

test('essentials: every tool is declared in package.json toolCatalog', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../packages/dsh-tool-ultra-pack-essentials/package.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(pkg.dsh.toolCatalog.tools).sort(), [...TOOL_NAMES].sort())
  assert.deepEqual(createTools().map((t) => t.name).sort(), [...TOOL_NAMES].sort())
  for (const n of TOOL_NAMES) assert.ok(!['web_fetch', 'web_search'].includes(n))
})

test('essentials: apply registers all tools minus disabled ones', () => {
  const registered = []
  apply({ tools: { register: (d) => registered.push(d.name ?? d.schema?.name) } }, { disable: ['math_eval'] })
  assert.equal(registered.length, TOOL_NAMES.length - 1)
})

test('essentials: time parsing and zone formatting', () => {
  const ms = parseTime('2026-11-01 15:30', 'Asia/Shanghai')
  assert.equal(new Date(ms).toISOString(), '2026-11-01T07:30:00.000Z')
  assert.equal(parseTime('2026-11-01T07:30:00Z', 'Asia/Shanghai'), ms)
  assert.match(formatInZone(ms, 'America/New_York'), /^2026-11-01T02:30:00-05:00 \(Sunday\)$/)
  // New York is still on EDT the day before.
  assert.match(formatInZone(parseTime('2026-10-31 12:00', 'America/New_York'), 'UTC'), /^2026-10-31T16:00:00\+00:00/)
})

test('essentials: time_convert, time_now, date_diff', async () => {
  const tools = createTools()
  const out = await tool(tools, 'time_convert').execute({ time: '2026-11-01 15:30', from_tz: 'Asia/Shanghai', to_tz: 'Europe/London' })
  assert.match(out, /Europe\/London: 2026-11-01T07:30:00\+00:00/)
  await assert.rejects(tool(tools, 'time_convert').execute({ time: 'now', to_tz: 'Mars/Base' }), /Unknown time zone/)
  assert.match(await tool(tools, 'time_now').execute({ timezone: 'UTC' }), /^UTC: \d{4}-/)
  const diff = await tool(tools, 'date_diff').execute({ from: '2026-01-01T00:00:00Z', to: '2026-03-01T12:00:00Z', unit: 'hours' })
  assert.match(diff, /^59d 12h 0m 0s\n= 1428 hours$/)
})

test('essentials: math_eval with units and multiple lines', async () => {
  const m = tool(createTools(), 'math_eval')
  assert.equal(await m.execute({ expression: '2 + 3 * 4' }), '14')
  assert.match(await m.execute({ expression: '5 km to mile' }), /^3\.10685596118\d* mile$/)
  assert.equal(await m.execute({ expression: 'a = 3\nb = a ^ 2\nb + 1' }), '3\n9\n10')
  assert.equal(await m.execute({ expression: 'a = 3; b = a ^ 2; b + 1' }), '10', '; hides a line result')
  await assert.rejects(m.execute({ expression: '2 +' }))
})

test('essentials: weather_forecast geocodes then formats Open-Meteo data', async () => {
  const { fetch, calls } = mockFetch([
    ['geocoding-api.open-meteo.com', { results: [{ name: 'Shenzhen', admin1: 'Guangdong', country: 'China', latitude: 22.5, longitude: 114.1, timezone: 'Asia/Shanghai' }] }],
    ['api.open-meteo.com/v1/forecast', {
      timezone: 'Asia/Shanghai',
      current_units: { temperature_2m: '°C', apparent_temperature: '°C', wind_speed_10m: 'km/h', precipitation: 'mm' },
      current: { time: '2026-11-01T15:00', temperature_2m: 26, apparent_temperature: 28, relative_humidity_2m: 70, weather_code: 2, wind_speed_10m: 9, precipitation: 0 },
      daily: { time: ['2026-11-01'], weather_code: [61], temperature_2m_min: [21], temperature_2m_max: [27], precipitation_sum: [3.2], precipitation_probability_max: [60], wind_speed_10m_max: [15] },
    }],
  ])
  const out = await tool(createTools({ fetch }), 'weather_forecast').execute({ location: 'Shenzhen', days: 1 })
  assert.match(out, /^Shenzhen, Guangdong, China \(Asia\/Shanghai\)/)
  assert.match(out, /partly cloudy, 26°C/)
  assert.match(out, /2026-11-01: light rain, 21\.\.27°C, rain 3\.2 mm \(60%\)/)
  assert.match(calls[1].url, /latitude=22\.5&longitude=114\.1/)
  assert.ok(calls[0].init.headers['User-Agent'].startsWith('dsh-tool-ultra'))
})

test('essentials: geo_search forward and reverse', async () => {
  const { fetch, calls } = mockFetch([
    ['/reverse', { display_name: 'Somewhere', lat: '1', lon: '2', category: 'place', type: 'city' }],
    ['/search', [{ display_name: 'Eiffel Tower, Paris', lat: '48.85', lon: '2.29', category: 'tourism', type: 'attraction' }]],
  ])
  const g = tool(createTools({ fetch }), 'geo_search')
  assert.match(await g.execute({ query: 'Eiffel Tower' }), /1\. Eiffel Tower, Paris\n {3}48\.85, 2\.29 · tourism\/attraction/)
  assert.match(await g.execute({ query: '1.0, 2.0' }), /Somewhere/)
  assert.match(calls[1].url, /reverse\?format=jsonv2&lat=1\.0&lon=2\.0/)
})

test('essentials: wikipedia search and summary', async () => {
  const { fetch, calls } = mockFetch([
    ['/search/page', { pages: [{ title: 'Rust (programming language)', description: 'Programming language', excerpt: 'a <span class="searchmatch">Rust</span> lang' }] }],
    ['/page/summary/', { type: 'standard', title: 'Rust (programming language)', description: 'Programming language', extract: 'Rust is a language.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Rust_(programming_language)' } } }],
  ])
  const tools = createTools({ fetch, wikiLang: 'zh' })
  assert.match(await tool(tools, 'wiki_search').execute({ query: 'rust', lang: 'en' }), /1\. Rust \(programming language\) \(Programming language\)\n {3}a Rust lang/)
  assert.match(calls[0].url, /^https:\/\/en\.wikipedia\.org\//)
  const s = await tool(tools, 'wiki_summary').execute({ title: 'Rust (programming language)' })
  assert.match(s, /Rust is a language\.\n\nhttps:\/\/en\.wikipedia\.org\/wiki\/Rust_/)
  assert.match(calls[1].url, /^https:\/\/zh\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Rust_\(programming_language\)/)
  await assert.rejects(tool(tools, 'wiki_search').execute({ query: 'x', lang: 'evil.com/' }), /Bad language code/)
})

test('essentials: HTTP errors surface as tool errors', async () => {
  const { fetch } = mockFetch([])
  await assert.rejects(tool(createTools({ fetch }), 'wiki_summary').execute({ title: 'Nope' }), /HTTP 404 from en\.wikipedia\.org/)
})
