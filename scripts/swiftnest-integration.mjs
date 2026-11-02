// Live integration with a real Swiftnest server: its pinned DSH kernel, its
// device hub and a paired Node Perch, with Tool Ultra (core + devices) added
// through the server's user.patch.yml. A scripted model drives tools_ls,
// tools_load and a device call; the script asserts on what the model was
// offered and what came back. Not part of CI: it needs a built Swiftnest
// checkout (pnpm install && pnpm build) and Node 24.
//
//   node scripts/swiftnest-integration.mjs <path/to/swiftnest>
//
// Everything lives in a throwaway SWIFTNEST_HOME on 127.0.0.1 with random ports.
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packages = resolve(here, '..', 'packages')
const swiftnest = resolve(process.argv[2] ?? '../swiftnest')
const req = createRequire(join(swiftnest, 'server', 'package.json'))
const load = (spec) => import(pathToFileURL(req.resolve(spec)).href)
const loadPath = (p) => import(pathToFileURL(join(swiftnest, p)).href)

const { startKernel } = await loadPath('server/dist/kernel.js')
const { loadConfig } = await loadPath('server/dist/config.js')
const { pairingUrl } = await loadPath('server/dist/pairing.js')
const { Perch } = await load('@swiftnest/core')
const { runLanPerch } = await load('@swiftnest/link-lan')
const files = (await load('@swiftnest/cap-files')).default
const shell = (await loadPath('plugins/cap-shell/dist/index.js')).default
const { connect } = await load('@swiftnest/api')
const WebSocket = (await load('ws')).default

let failed = 0
function check(label, ok, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${String(detail).slice(0, 1500).replace(/\n/g, '\n      ')}`}`)
}

// --- scripted model ------------------------------------------------------------
// Each prompt names a scenario; round N of a scenario gets steps[N].
const home = await mkdtemp(join(tmpdir(), 'tu-swiftnest-'))
const shared = join(home, 'shared')
await mkdir(shared)
await writeFile(join(shared, 'hello.txt'), 'hello from the laptop perch')
const scenarios = {
  'tu-ls': [{ name: 'tools_ls', arguments: { path: '/device' } }],
  'tu-area': [
    { name: 'tools_load', arguments: { targets: ['device:laptop/files'] } },
    { name: 'device__laptop__files_read', arguments: { path: join(shared, 'hello.txt') } },
  ],
  'tu-current': [{ name: 'tools_load', arguments: { targets: ['device:current'] } }],
  'tu-offline': [{ name: 'tools_ls', arguments: { path: '/device' } }],
}
const requests = []
const rounds = new Map()
const userText = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
const model = createServer(async (rq, res) => {
  if (rq.url === '/v1/models') { res.end('{"data":[{"id":"fake"}]}'); return }
  let raw = ''
  for await (const part of rq) raw += String(part)
  const request = JSON.parse(raw)
  const kind = [...request.messages].reverse().map((m) => m.role === 'user' && userText(m)).find((t) => t && t in scenarios)
  if (kind) requests.push({ kind, round: rounds.get(kind) ?? 0, request })
  let tool
  if (kind && request.stream) {
    const round = rounds.get(kind) ?? 0
    rounds.set(kind, round + 1)
    const step = scenarios[kind][round]
    if (step) tool = { name: step.name, arguments: JSON.stringify(step.arguments) }
  }
  if (!request.stream) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: 't', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'Done.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
  chunk({ role: 'assistant', content: '' })
  if (tool) { chunk({ tool_calls: [{ index: 0, id: `call-${kind}-${rounds.get(kind)}`, type: 'function', function: tool }] }); chunk({}, 'tool_calls') }
  else { chunk({ content: 'Done.' }); chunk({}, 'stop') }
  res.end('data: [DONE]\n\n')
})

const offered = (kind, round) => requests.find((r) => r.kind === kind && r.round === round)?.request.tools?.map((t) => t.function.name) ?? []
const deviceTools = (names) => names.filter((n) => n.startsWith('device__')).sort()
const toolResult = (events) => events.filter((e) => e.type === 'tool-result').map((e) => `${e.isError ? '[error] ' : ''}${e.text}`)

let kernel, client, nativeClient, perch, run
const logs = []
try {
  await new Promise((r) => model.listen(0, '127.0.0.1', r))
  // Tool Ultra goes in through the operator's patch file, as a user would add it.
  await mkdir(join(home, 'dsh/profiles/swiftnest'), { recursive: true })
  await writeFile(join(home, 'dsh/profiles/swiftnest/user.patch.yml'), JSON.stringify([{ insert: [
    { id: 'tool-manager', name: join(packages, 'dsh-tool-ultra-core/lib/index.js'), config: { pinned: [], unpin: [], exemptProviders: ['claude-code'], highRisk: [] } },
    { id: 'tool-ultra-devices', name: join(packages, 'dsh-tool-ultra-devices/lib/index.js'), config: {} },
  ] }]))
  kernel = await startKernel(loadConfig(undefined, {
    SWIFTNEST_HOME: home, SWIFTNEST_PORT: '0', SWIFTNEST_DEVICES_PORT: '0', SWIFTNEST_DEVICES_MDNS: 'false',
    SWIFTNEST_MODEL_ID: 'fake', SWIFTNEST_MODEL_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`,
  }), { onLine: (l) => logs.push(l.replace(/token=[^&\s]+/g, 'token=…')) })
  console.log(`Swiftnest kernel up at ${kernel.url}`)

  const ws = (url, { headers }) => new WebSocket(url, { headers })
  client = await connect(pairingUrl(kernel.url, kernel.token), { createWebSocket: ws })
  const session = await client.createSession()
  async function turn(prompt, sender = client, sessionId = session.sessionId) {
    const sub = await sender.follow(sessionId, { signal: AbortSignal.timeout(30_000) })
    const events = []
    let started = false
    const done = (async () => {
      for await (const e of sub) {
        if (e.type === 'user-message' && e.text === prompt) started = true
        if (!started) continue
        events.push(e)
        if (e.type === 'approval-request') await sender.answerApproval(e.requestId, 'allowed-once')
        if (e.type === 'turn-end') break
      }
    })()
    await sender.sendMessage(sessionId, prompt)
    await done
    sub.close()
    const errors = events.filter((e) => e.type === 'error')
    if (errors.length) console.log(`      errors in ${prompt}: ${JSON.stringify(errors)}`)
    return events
  }
  const poll = async (fn, ms = 15_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)) } return false }

  // Pair a Node Perch called "laptop" with files and shell.
  const pairing = await client.createDevicePairing()
  perch = await new Perch({ device: 'laptop' }).use(files, { roots: [shared] })
  await perch.use(shell)
  run = runLanPerch(perch, { url: pairing.url, reconnect: false, pairing: { code: pairing.code, confirm: async (fp) => fp === pairing.fingerprint } })
  await poll(async () => (await client.listDevicePairings()).length === 1)
  await client.confirmDevicePairing((await client.listDevicePairings())[0].id, true)
  check('perch "laptop" pairs and comes online', await poll(async () => (await client.listDevices())[0]?.online === true), JSON.stringify(await client.listDevices()))

  // 1. Directory: device tools are filed under /device/laptop and start hidden.
  const ls = await turn('tu-ls')
  const lsText = toolResult(ls).join('\n')
  check('tu-ls: Tool Ultra is active (tools_ls offered)', offered('tu-ls', 0).includes('tools_ls'), offered('tu-ls', 0).join(', '))
  check('tu-ls: device tools start hidden', deviceTools(offered('tu-ls', 0)).length === 0, deviceTools(offered('tu-ls', 0)).join(', '))
  check('tu-ls: /device lists laptop with its kind', /laptop\/[^\n]*\(desktop\)/.test(lsText), lsText)

  // 2. Area target: device:laptop/files loads files_* only, and a read goes through the Nest.
  const area = await turn('tu-area')
  const loaded = deviceTools(offered('tu-area', 1))
  check('tu-area: device:laptop/files loads every files_* tool and nothing else', loaded.length > 0 && loaded.every((n) => n.startsWith('device__laptop__files_')), loaded.join(', '))
  check('tu-area: files_read is among them', loaded.includes('device__laptop__files_read'), loaded.join(', '))
  check('tu-area: the device read returns the file', toolResult(area).some((t) => t.includes('hello from the laptop perch')), toolResult(area).join('\n'))

  // 3. device:current from a native App connection that reports deviceSlug "laptop".
  nativeClient = await connect(pairingUrl(kernel.url, kernel.token), { deviceSlug: 'laptop', createWebSocket: ws })
  const fresh = await nativeClient.createSession()
  const cur = await turn('tu-current', nativeClient, fresh.sessionId)
  const curLoaded = deviceTools(offered('tu-current', 1))
  check('tu-current: device:current loads the laptop tools, shell included', curLoaded.includes('device__laptop__files_read') && curLoaded.includes('device__laptop__shell_run'), `${curLoaded.join(', ')}\n${toolResult(cur).join('\n')}`)

  // 4. Offline: tools stay, the directory marks the device offline.
  run.stop(); await run.finished
  await poll(async () => (await client.listDevices())[0]?.online === false)
  const off = await turn('tu-offline')
  const offText = toolResult(off).join('\n')
  check('tu-offline: laptop is marked offline in /device', /laptop\/[^\n]*\[offline/.test(offText), offText)
} catch (e) {
  failed++
  console.log(`FAIL  ${e?.stack ?? e}\n--- kernel log ---\n${logs.slice(-60).join('\n')}`)
} finally {
  run?.stop(); await run?.finished; await perch?.close(); nativeClient?.close(); client?.close(); await kernel?.stop()
  await new Promise((r) => model.close(() => r()))
  await rm(home, { recursive: true, force: true })
}
if (failed) console.log(`\n--- kernel log (tail) ---\n${logs.slice(-30).join('\n')}`)
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
