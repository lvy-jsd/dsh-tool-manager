# @lvy-jsd/dsh-tool-ultra-pack-web

Web-reading tools for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra). No API keys.

| Tool | Group / category | What it does |
| --- | --- | --- |
| `web_read` | web / search | Fetch a page and return the main article as Markdown, with title, author, date and absolute links. Plain text and JSON pass through. `offset` and `max_chars` page through long documents; `full_page` converts the whole body. |
| `web_links` | web / search | List a page's links, optionally filtered by a word or limited to the same site. |

Extraction uses [Mozilla Readability](https://github.com/mozilla/readability) (Apache-2.0) on a [linkedom](https://github.com/WebReflection/linkedom) DOM (ISC), and [turndown](https://github.com/mixmark-io/turndown) (MIT) for Markdown. Everything is TypeScript/JavaScript, with no headless browser. For pages that need JavaScript to render, use a browser pack (Playwright MCP).

The names do not collide with DSH's built-in `web_fetch` and `web_search`. Those stay available for raw fetches and search.

## Safety

The tools refuse loopback, private, link-local and CGNAT addresses, so a model cannot reach services on the DSH host or its LAN (for example `169.254.169.254` or `192.168.x.x`). The check runs on the resolved IP and again on every redirect hop. Set `allowPrivate: true` only if you trust every agent that can load these tools. Response bodies are capped at `maxBytes`.

## Config

See [`cordis.patch.yml`](cordis.patch.yml): `disable`, `userAgent`, `timeoutMs`, `maxBytes`, `maxChars`, `allowPrivate`.

## License

Apache-2.0.
