# Trial tools

Used to run a copy of a real DSH profile against a real model provider without
side effects on the live installation. Nothing here contains machine paths or
secrets.

- `record-proxy.mjs` — OpenAI-compatible recording proxy. DSH uses a dummy key;
  the proxy forwards to `UPSTREAM` with `UPSTREAM_KEY` from its own environment
  and logs, per request, the tools offered, their schema size and the
  provider's usage block (including prompt-cache hits).
- `driver/` — trial-only plugin: starts one session through the host webhook
  runtime (agent preset mounted, like a web session) and installs a global
  guard that refuses every tool outside an allowlist regex.

See `docs/DESIGN.md` §13 for the isolation checklist (separate `DSH_HOME` and
`HOME`, `ADB_SERVER_PORT`, outward-facing plugins disabled) and the results.
