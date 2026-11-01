// Live smoke test for the tool packs, against the real services.
// Not part of CI: it needs network access and downloads MCP servers with npx.
//
//   node scripts/smoke-packs.mjs            # essentials + web + keyless MCP presets
//   node scripts/smoke-packs.mjs --no-mcp   # skip the MCP presets
//
// Build first (npm run build). Exits non-zero if any check fails.
import { spawn } from 'node:child_process'
import { createTools as essentials } from '../packages/dsh-tool-ultra-pack-essentials/lib/index.js'
import { createTools as web } from '../packages/dsh-tool-ultra-pack-web/lib/index.js'
import { planPresets } from '../packages/dsh-tool-ultra-pack-mcp/lib/index.js'

let failed = 0
async function check(label, fn, pattern) {
  const started = Date.now()
  try {
    const out = String(await fn())
    const ok = pattern.test(out)
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} (${Date.now() - started} ms)\n      ${out.slice(0, 200).replace(/\n/g, '\n      ')}`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${label}: ${e.message}${e.cause ? ` (${e.cause.message ?? e.cause})` : ''}`)
  }
}

const ess = Object.fromEntries(essentials().map((t) => [t.name, t]))
await check('time_now', () => ess.time_now.execute({ timezone: 'Asia/Shanghai' }), /Asia\/Shanghai: \d{4}-/)
await check('math_eval', () => ess.math_eval.execute({ expression: '100 degF to degC' }), /37\.7\d* degC/)
await check('weather_forecast (Open-Meteo)', () => ess.weather_forecast.execute({ location: 'Shenzhen', days: 2 }), /Shenzhen[\s\S]*Now/)
await check('geo_search (Nominatim)', () => ess.geo_search.execute({ query: 'Eiffel Tower', limit: 1 }), /Paris[\s\S]*48\.8/)
await check('wiki_search (zh)', () => ess.wiki_search.execute({ query: '深圳', lang: 'zh', limit: 2 }), /深圳/)
await check('wiki_summary (en)', () => ess.wiki_summary.execute({ title: 'Rust (programming language)' }), /wikipedia\.org\/wiki\/Rust/)

const w = Object.fromEntries(web().map((t) => [t.name, t]))
await check('web_read (article)', () => w.web_read.execute({ url: 'https://en.wikipedia.org/wiki/Markdown', max_chars: 3000 }), /^# .*Markdown[\s\S]*URL: https:\/\/en\.wikipedia\.org/)
await check('web_links', () => w.web_links.execute({ url: 'https://example.com/', limit: 5 }), /link\(s\) on https:\/\/example\.com/)
await check('web_read refuses LAN', () => w.web_read.execute({ url: 'http://192.168.1.1/' }).catch((e) => e.message), /private address/)

/** Start one stdio MCP server, initialize, list tools, stop. */
function listTools(client, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(client.command, client.args, { env: { ...process.env, ...client.env }, stdio: ['pipe', 'pipe', 'ignore'] })
    const timer = setTimeout(() => { child.kill(); reject(new Error('timed out')) }, timeoutMs)
    let buf = ''
    const send = (msg) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
    child.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id === 1) {
          send({ method: 'notifications/initialized' })
          send({ id: 2, method: 'tools/list', params: {} })
        } else if (msg.id === 2) {
          clearTimeout(timer)
          child.kill()
          if (msg.error) reject(new Error(msg.error.message))
          else resolve(msg.result.tools.map((t) => t.name))
        }
      }
    })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tool-ultra-smoke', version: '0' } } })
  })
}

if (!process.argv.includes('--no-mcp')) {
  for (const p of planPresets({}, {}).filter((p) => p.status === 'on' && p.client?.transport === 'stdio')) {
    await check(`mcp preset ${p.preset.id} starts and lists tools`, async () => (await listTools(p.client)).join(', '), /\w/)
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
