// Web-reading pack: extraction, link listing and the private-address guard, with a mocked fetch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTools, apply, TOOL_NAMES, isPrivateAddress, htmlToMarkdown } from '../../packages/dsh-tool-ultra-pack-web/lib/index.js'

const ARTICLE = `<!doctype html><html><head><title>Cats | Site</title><meta property="og:site_name" content="Example"></head><body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<article><h1>All about cats</h1><p class="byline">By Jane Doe</p>
<p>Cats are small carnivorous mammals. ${'They sleep a lot and like boxes. '.repeat(20)}</p>
<h2>Food</h2><p>Cats eat <a href="/food">fish</a> and <strong>mice</strong>.</p>
<pre><code>meow()</code></pre></article>
<footer>Copyright <a href="https://other.example/x#frag">Other</a></footer><script>evil()</script></body></html>`

function mock(pages, calls = []) {
  const fetch = async (url) => {
    calls.push(url)
    const p = pages[url]
    if (!p) return { status: 404, headers: new Headers() }
    if (p.redirect) return { status: 302, headers: new Headers({ location: p.redirect }) }
    return { status: 200, headers: new Headers({ 'content-type': p.type ?? 'text/html; charset=utf-8' }), body: new Response(p.body).body }
  }
  return { fetch, resolve: async (h) => (h.endsWith('.internal') ? ['10.0.0.5'] : ['93.184.216.34']), calls }
}
const tool = (tools, n) => tools.find((t) => t.name === n)

test('web: tools match the package.json catalog and avoid built-in names', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../packages/dsh-tool-ultra-pack-web/package.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(pkg.dsh.toolCatalog.tools).sort(), [...TOOL_NAMES].sort())
  assert.ok(!TOOL_NAMES.includes('web_fetch'))
  const reg = []
  apply({ tools: { register: (d) => reg.push(d) } }, { disable: ['web_links'] })
  assert.equal(reg.length, 1)
})

test('web: private address detection', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.6.118', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.ok(isPrivateAddress(ip), ip)
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip)
})

test('web: htmlToMarkdown keeps the article and drops chrome', () => {
  const ex = htmlToMarkdown(ARTICLE, 'https://cats.example/post')
  assert.match(ex.markdown, /Cats are small carnivorous mammals/)
  assert.match(ex.markdown, /## Food/)
  assert.match(ex.markdown, /\[fish\]\(https:\/\/cats\.example\/food\)/)
  assert.match(ex.markdown, /```\nmeow\(\)\n```/)
  assert.doesNotMatch(ex.markdown, /evil\(\)|Copyright|About/)
})

test('web_read: follows redirects, returns header and text, honours max_chars and offset', async () => {
  const m = mock({ 'https://cats.example/old': { redirect: '/post' }, 'https://cats.example/post': { body: ARTICLE } })
  const t = tool(createTools(m), 'web_read')
  const out = await t.execute({ url: 'https://cats.example/old' })
  assert.match(out, /^# .*cats/i)
  assert.match(out, /URL: https:\/\/cats\.example\/post/)
  assert.deepEqual(m.calls, ['https://cats.example/old', 'https://cats.example/post'])
  const short = await t.execute({ url: 'https://cats.example/post', max_chars: 500 })
  assert.match(short, /\[truncated: \d+ more characters/)
  const full = await t.execute({ url: 'https://cats.example/post', full_page: true })
  assert.match(full, /Copyright/)
})

test('web_read: plain text passes through, binaries are refused', async () => {
  const m = mock({ 'https://x.example/a.txt': { body: 'hello', type: 'text/plain' }, 'https://x.example/a.zip': { body: 'PK', type: 'application/zip' } })
  const t = tool(createTools(m), 'web_read')
  assert.match(await t.execute({ url: 'https://x.example/a.txt' }), /Type: text\/plain\n\nhello$/)
  await assert.rejects(t.execute({ url: 'https://x.example/a.zip' }), /Unsupported content type/)
})

test('web_read: refuses private targets, including via redirect, unless allowed', async () => {
  const m = mock({ 'https://ok.example/r': { redirect: 'http://127.0.0.1:8080/admin' }, 'http://svc.internal/': { body: 'secret', type: 'text/plain' } })
  const t = tool(createTools(m), 'web_read')
  await assert.rejects(t.execute({ url: 'http://localhost:3000/' }), /private address/)
  await assert.rejects(t.execute({ url: 'http://svc.internal/' }), /private address svc\.internal -> 10\.0\.0\.5/)
  await assert.rejects(t.execute({ url: 'https://ok.example/r' }), /private address 127\.0\.0\.1/)
  await assert.rejects(t.execute({ url: 'file:///etc/passwd' }), /Only http and https/)
  const open = tool(createTools({ ...m, allowPrivate: true }), 'web_read')
  assert.match(await open.execute({ url: 'http://svc.internal/' }), /secret/)
})

test('web_links: absolute, deduplicated, filterable', async () => {
  const m = mock({ 'https://cats.example/post': { body: ARTICLE } })
  const t = tool(createTools(m), 'web_links')
  const all = await t.execute({ url: 'https://cats.example/post' })
  assert.match(all, /- \[Home\]\(https:\/\/cats\.example\/\)/)
  assert.match(all, /\(https:\/\/other\.example\/x\)/)
  const same = await t.execute({ url: 'https://cats.example/post', same_site: true })
  assert.doesNotMatch(same, /other\.example/)
  assert.match(await t.execute({ url: 'https://cats.example/post', filter: 'fish' }), /^1 link\(s\)/)
})
