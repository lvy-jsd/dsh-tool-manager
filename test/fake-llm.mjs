// Scripted OpenAI-compatible Chat Completions server for end-to-end tests.
//
// Every request that carries tools takes the next step from the script and is
// logged with the exact tool names the model was offered. Requests without
// tools (title generation and similar) get a plain text answer — except a
// classifier prompt, which gets the category set by FAKE_CLASSIFIER_CATEGORY
// (default "maps") so dsh-tool-manager-classifier-llm can be exercised.
//
// Usage: node fake-llm.mjs <port> <script.json> <log.jsonl>
//   script: [{ "tool_calls": [{ "name": "...", "arguments": {...} }] } | { "text": "..." }, ...]
import { createServer } from 'node:http'
import { readFileSync, appendFileSync } from 'node:fs'

const [port, scriptPath, logPath] = process.argv.slice(2)
const script = JSON.parse(readFileSync(scriptPath, 'utf8'))
let step = 0
let callSeq = 0

function systemText(messages) {
  return messages.filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
}

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

function completion(model, delta, finish) {
  const base = { id: `fake-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model }
  return [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
    { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ]
}

createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'fake-1' }] }))
    return
  }
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    const payload = JSON.parse(body || '{}')
    const tools = (payload.tools ?? []).map((t) => t.function?.name ?? t.name).filter(Boolean)
    const messages = payload.messages ?? []
    if (tools.length === 0) {
      const text = systemText(messages) + messages.map((m) => JSON.stringify(m.content ?? '')).join(' ')
      const isClassifier = /Answer with exactly one of these category names/.test(text)
      appendFileSync(logPath, JSON.stringify({ kind: 'no-tools', classifier: isClassifier }) + '\n')
      sse(res, completion(payload.model, { content: isClassifier ? (process.env.FAKE_CLASSIFIER_CATEGORY ?? 'maps') : 'Test session' }, 'stop'))
      return
    }
    const current = script[step] ?? { text: 'done' }
    const sys = systemText(messages)
    appendFileSync(logPath, JSON.stringify({
      kind: 'turn', step, tools,
      subagent: /delegat|subagent/i.test(sys.slice(0, 20000)) && /You are a subagent|delegated/i.test(sys),
      lastRole: messages.at(-1)?.role,
      lastContent: String(typeof messages.at(-1)?.content === 'string' ? messages.at(-1).content : JSON.stringify(messages.at(-1)?.content ?? '')).slice(0, 6000),
    }) + '\n')
    step += 1
    // `delayMs` holds the answer back, so background work (a source scan, a
    // classifier) can finish before the next step.
    setTimeout(() => reply(current, payload.model), current.delayMs ?? 0)
  })
  function reply(current, model) {
    if (current.tool_calls) {
      const calls = current.tool_calls.map((c, index) => ({
        index, id: `call_${++callSeq}`, type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
      }))
      sse(res, completion(model, { content: null, tool_calls: calls }, 'tool_calls'))
    } else {
      sse(res, completion(model, { content: current.text ?? 'done' }, 'stop'))
    }
  }
}).listen(Number(port), '127.0.0.1', () => console.error(`fake-llm on ${port}`))
