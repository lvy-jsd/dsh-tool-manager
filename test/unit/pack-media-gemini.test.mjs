import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { resolveSettings, transcribeTool, understandTool } from '../../packages/dsh-tool-ultra-pack-media/lib/index.js'
import { analyseGemini } from '../../packages/dsh-tool-ultra-pack-media/lib/gemini/client.js'
import { DEFAULT_GEMINI_KEY_FILE, DEFAULT_GEMINI_MODEL, resolveGeminiKey } from '../../packages/dsh-tool-ultra-pack-media/lib/gemini/settings.js'

const ORIGIN = 'https://generativelanguage.googleapis.com'
const API = `${ORIGIN}/v1beta`
const UPLOAD = `${ORIGIN}/upload/v1beta/files?upload_id=test`
const KEY = 'test-secret+/do-not-echo'
const SRT = '1\n00:00:00,000 --> 00:00:02,000\nSpeaker 1 (happy): 你好\n'
const json = (value, status = 200) => Response.json(value, { status })
const candidate = (text) => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'media-gemini-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const oldKey = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  t.after(() => {
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = oldKey
  })
  const path = join(dir, 'clip.mp4')
  await writeFile(path, 'media bytes')
  const settings = resolveSettings({ outputDir: dir, geminiKeyFile: join(dir, 'missing.key'), lang: 'en' })
  return { dir, path, settings }
}

function mockApi(t, options = {}) {
  const calls = []
  let polls = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, ...init })
    if (init.method === 'DELETE') {
      if (options.deleteError) throw new Error(KEY)
      return new Response(null, { status: 204 })
    }
    if (url === `${ORIGIN}/upload/v1beta/files`) {
      if (options.startError) throw new Error(`fetch ${url}?key=${KEY}\n${encodeURIComponent(KEY)}`)
      return new Response(null, { headers: { 'x-goog-upload-url': options.uploadUrl ?? UPLOAD } })
    }
    if (url === UPLOAD) return json({ file: { name: 'files/test', uri: `${API}/files/test`, state: 'PROCESSING' } })
    if (url === `${API}/files/test`) {
      polls++
      return json({ name: 'files/test', uri: `${API}/files/test`, state: options.state ?? (polls === 1 ? 'PROCESSING' : 'ACTIVE') })
    }
    if (url.endsWith(':generateContent')) {
      if (options.generateError) return json({ error: { message: `${KEY}\n${encodeURIComponent(KEY)}` } }, 429)
      return options.response?.() ?? candidate(options.text ?? SRT)
    }
    assert.fail(`Unexpected URL: ${url}`)
  })
  return calls
}

test('Gemini: key precedence, whitespace, missing/empty files, tilde default and environment', async (t) => {
  const { dir, settings } = await fixture(t)
  assert.equal(settings.gemini.model, DEFAULT_GEMINI_MODEL)
  assert.equal(resolveSettings({}).gemini.keyFile, DEFAULT_GEMINI_KEY_FILE)
  const keyFile = join(dir, 'gemini.key')
  await writeFile(keyFile, '  file-key\n')
  process.env.GEMINI_API_KEY = ' env-key\n'
  assert.equal(await resolveGeminiKey({ ...settings.gemini, apiKey: ' config-key\n', keyFile }), 'config-key')
  assert.equal(await resolveGeminiKey({ ...settings.gemini, apiKey: ' ', keyFile }), 'file-key')
  await writeFile(keyFile, ' \n')
  assert.equal(await resolveGeminiKey({ ...settings.gemini, keyFile }), 'env-key')
  assert.equal(await resolveGeminiKey(settings.gemini), 'env-key')
  delete process.env.GEMINI_API_KEY
  assert.equal(await resolveGeminiKey(settings.gemini), undefined)
  await assert.rejects(resolveGeminiKey({ ...settings.gemini, keyFile: dir }), /keyFile/)
})

test('Gemini: REST upload → processing → active → generate → delete uses only header credentials', async (t) => {
  const { path } = await fixture(t)
  const calls = mockApi(t)
  assert.equal(await analyseGemini(path, 'Describe motion and OCR.', DEFAULT_GEMINI_MODEL, KEY, { pollMs: 0 }), SRT)
  assert.deepEqual(calls.map((c) => [c.url, c.method]), [
    [`${ORIGIN}/upload/v1beta/files`, 'POST'], [UPLOAD, 'POST'],
    [`${API}/files/test`, 'GET'], [`${API}/files/test`, 'GET'],
    [`${API}/models/${DEFAULT_GEMINI_MODEL}:generateContent`, 'POST'], [`${API}/files/test`, 'DELETE'],
  ])
  for (const call of calls) {
    assert.equal(call.headers.get('x-goog-api-key'), KEY)
    assert.equal(new URL(call.url).searchParams.has('key'), false)
    assert.ok(call.signal instanceof AbortSignal)
    assert.equal(call.redirect, 'error')
  }
  assert.equal(calls[0].headers.get('x-goog-upload-protocol'), 'resumable')
  assert.equal(calls[0].headers.get('x-goog-upload-command'), 'start')
  assert.equal(calls[0].headers.get('x-goog-upload-header-content-length'), '11')
  assert.equal(calls[0].headers.get('x-goog-upload-header-content-type'), 'video/mp4')
  assert.deepEqual(JSON.parse(calls[0].body), { file: { display_name: 'media' } })
  assert.equal(calls[1].headers.get('x-goog-upload-command'), 'upload, finalize')
  assert.equal(calls[1].headers.get('x-goog-upload-offset'), '0')
  assert.equal(calls[1].headers.get('content-length'), '11')
  assert.equal(await calls[1].body.text(), 'media bytes')
  assert.deepEqual(JSON.parse(calls[4].body).contents[0].parts, [
    { file_data: { mime_type: 'video/mp4', file_uri: `${API}/files/test` } }, { text: 'Describe motion and OCR.' },
  ])
})

test('Gemini: errors are key-free and generation failures still delete the file', async (t) => {
  const { path } = await fixture(t)
  const calls = mockApi(t, { generateError: true })
  await assert.rejects(analyseGemini(path, 'test', DEFAULT_GEMINI_MODEL, KEY, { pollMs: 0 }), (error) => {
    assert.equal(error.message, 'HTTP 429')
    assert.doesNotMatch(String(error), /test-secret|do-not-echo/)
    return true
  })
  assert.equal(calls.at(-1).method, 'DELETE')
})

test('Gemini: FAILED, processing timeout, malformed and blocked responses delete the file', async (t) => {
  for (const options of [
    { state: 'FAILED' }, { state: 'PROCESSING' }, { response: () => json({}) },
    { response: () => json({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'blocked' }] } }] }) },
  ]) {
    await t.test(JSON.stringify(options), async (t) => {
      const { path } = await fixture(t)
      const calls = mockApi(t, options)
      await assert.rejects(analyseGemini(path, 'test', DEFAULT_GEMINI_MODEL, KEY, { pollMs: 0, timeoutMs: options.state === 'PROCESSING' ? 100 : 1000 }))
      assert.equal(calls.at(-1).method, 'DELETE')
    })
  }
})

test('Gemini: requests and body reads time out even if fetch ignores abort', async (t) => {
  const { path } = await fixture(t)
  for (const response of [() => new Promise(() => {}), () => ({ ok: true, headers: { get: () => UPLOAD }, json: () => new Promise(() => {}) })]) {
    t.mock.method(globalThis, 'fetch', response)
    await assert.rejects(analyseGemini(path, 'test', DEFAULT_GEMINI_MODEL, KEY, { timeoutMs: 15 }), /timeout/)
    t.mock.restoreAll()
  }
})

test('Gemini: unsafe upload URLs, oversized files and invalid models fail before sending media', async (t) => {
  const { path } = await fixture(t)
  for (const uploadUrl of ['https://example.org/upload', `${UPLOAD}&key=${encodeURIComponent(KEY)}`, 'http://generativelanguage.googleapis.com/upload/v1beta/files']) {
    const calls = mockApi(t, { uploadUrl })
    await assert.rejects(analyseGemini(path, 'test', DEFAULT_GEMINI_MODEL, KEY), /uploadUrl/)
    assert.equal(calls.length, 1)
    t.mock.restoreAll()
  }
  const calls = mockApi(t)
  await assert.rejects(analyseGemini(path, 'test', `bad/model?key=${KEY}`, KEY), /model/)
  await truncate(path, 2 * 1024 ** 3 + 1)
  await assert.rejects(analyseGemini(path, 'test', DEFAULT_GEMINI_MODEL, KEY), /tooLarge/)
  assert.equal(calls.length, 0)
})

/** Stub both media programs, while still making real storyboards and subtitle files. */
function mediaDeps(video = false) {
  const calls = []
  let localCalls = 0
  const run = async (program, args) => {
    calls.push(program)
    if (program === 'ffprobe') return JSON.stringify({
      format: { duration: '3' },
      streams: [{ codec_type: 'audio' }, ...(video ? [{ codec_type: 'video', width: 320, height: 180, avg_frame_rate: '24/1' }] : [])],
    })
    const output = args.at(-1)
    if (output === '-') return ''
    if (output.endsWith('.jpg')) {
      await writeFile(output.replace('%02d', '01'), await sharp({ create: { width: 320, height: 180, channels: 3, background: '#345' } }).jpeg().toBuffer())
    } else await writeFile(output, Buffer.from(new Float32Array(16000).buffer))
    return ''
  }
  const transcriber = async () => {
    localCalls++
    return [{ start: 0, end: 1, text: 'local words' }]
  }
  return { run, transcriber, calls, localCalls: () => localCalls }
}

test('media engines: auto with and without a key, local with a key, and gemini with and without a key', async (t) => {
  for (const factory of [transcribeTool, understandTool]) {
    for (const [engine, key, expectedRemote] of [[undefined, true, true], [undefined, false, false], ['auto', true, true], ['auto', false, false], ['local', true, false], ['gemini', true, true], ['gemini', false, false]]) {
      await t.test(`${factory.name}/${engine}/${key}`, async (t) => {
        const { settings } = await fixture(t)
        if (key) settings.gemini.apiKey = KEY
        const calls = mockApi(t, { state: 'ACTIVE' })
        const deps = mediaDeps()
        const tool = factory(settings, deps)
        assert.deepEqual(tool.parameters.engine.enum, ['auto', 'local', 'gemini'])
        assert.equal(tool.parameters.engine.default, 'auto')
        const result = await tool.execute({ file: 'clip.mp4', engine })
        assert.match(result, /File .*clip.mp4: 00:03 long, no picture, with sound/)
        assert.equal(calls.length > 0, expectedRemote)
        assert.equal(deps.localCalls(), expectedRemote ? 0 : 1)
        if (expectedRemote) assert.match(result, new RegExp(`analysed by Gemini ${DEFAULT_GEMINI_MODEL} \\(file uploaded to Google\\)`))
        else assert.doesNotMatch(result, /analysed by Gemini/)
        if (engine === 'gemini' && !key) assert.equal(result.split('\n')[0], 'no Gemini key configured (set geminiApiKey or ~/.config/swiftnest/gemini.key)')
        await assert.rejects(tool.execute({ file: 'clip.mp4', engine: 'unknown' }), /engine must/)
      })
    }
  }
})

test('media engines: HTTP and fetch failures return one safe reason line then the local pipeline', async (t) => {
  for (const factory of [transcribeTool, understandTool]) {
    for (const options of [{ generateError: true }, { startError: true }]) {
      await t.test(`${factory.name}/${JSON.stringify(options)}`, async (t) => {
        const { settings } = await fixture(t)
        settings.gemini.apiKey = KEY
        const calls = mockApi(t, { ...options, state: 'ACTIVE' })
        const deps = mediaDeps()
        const result = await factory(settings, deps).execute({ file: 'clip.mp4' })
        const reason = options.generateError ? 'HTTP 429' : 'network request failed'
        assert.equal(result.split('\n')[0], `Gemini unavailable; using local: ${reason}`)
        assert.match(result, /\nFile .*clip.mp4/)
        assert.match(result, /local words/)
        assert.doesNotMatch(result, /test-secret|do-not-echo|test-secret%2B/)
        assert.equal(deps.localCalls(), 1)
        if (options.generateError) assert.equal(calls.at(-1).method, 'DELETE')
      })
    }
  }
})

test('media engines: Gemini saves storyboard and SRT, honours options, and redacts echoed keys', async (t) => {
  const { settings } = await fixture(t)
  settings.gemini.apiKey = KEY
  settings.gemini.model = 'custom-flash'
  const calls = mockApi(t, { text: `[00:00] action, OCR ${KEY} ${encodeURIComponent(KEY)}`, state: 'ACTIVE', deleteError: true })
  const deps = mediaDeps(true)
  const video = await understandTool(settings, deps).execute({ file: 'clip.mp4', frames: 4, transcript: false })
  assert.match(video, /analysed by Gemini custom-flash \(file uploaded to Google\)/)
  assert.match(video, /320×180, 24 fps, with sound/)
  const board = /Storyboard .*: (.+\.jpg)\n/.exec(video)[1]
  assert.ok((await sharp(board).metadata()).width > 0)
  assert.doesNotMatch(video, /test-secret|do-not-echo/)
  assert.equal(deps.localCalls(), 0)
  const request = JSON.parse(calls.find((c) => c.url.endsWith(':generateContent')).body)
  assert.match(request.contents[0].parts[1].text, /on-screen text \(OCR\), actions and motion/)
  assert.match(request.contents[0].parts[1].text, /Do not include a speech transcript/)
  t.mock.restoreAll()
  const audioCalls = mockApi(t, { text: SRT.replace('你好', KEY), state: 'ACTIVE' })
  const audio = await transcribeTool(settings, mediaDeps()).execute({ file: 'clip.mp4', speakers: false, language: 'zh' })
  const subtitles = /Subtitles saved: (.+\.srt)/.exec(audio)[1]
  assert.match(await readFile(subtitles, 'utf8'), /Speaker 1 \(happy\): \[redacted\]/)
  assert.doesNotMatch(audio, /test-secret|do-not-echo/)
  const prompt = JSON.parse(audioCalls.find((c) => c.url.endsWith(':generateContent')).body).contents[0].parts[1].text
  assert.match(prompt, /SRT subtitles only/)
  assert.match(prompt, /Do not label speakers/)
  assert.match(prompt, /original language \(zh\)/)
})

test('media engines: malformed audio, key-file failures and Chinese copy fall back locally', async (t) => {
  const { settings, dir } = await fixture(t)
  settings.gemini.apiKey = KEY
  mockApi(t, { text: 'not subtitles', state: 'ACTIVE' })
  const deps = mediaDeps()
  assert.match(await transcribeTool(settings, deps).execute({ file: 'clip.mp4' }), /^Gemini unavailable; using local: Google returned an unreadable response\nFile/)
  settings.gemini.apiKey = undefined
  settings.gemini.keyFile = dir
  settings.html.lang = 'zh-CN'
  assert.match(await transcribeTool(settings, deps).execute({ file: 'clip.mp4' }), /^Gemini 不可用，已改用本地处理：无法读取 Gemini 密钥文件\nFile/)
  assert.match(transcribeTool(settings, deps).description, /上传到 Google/)
})
