// A thin client over the Rust sidecar. It spawns the binary, pushes the
// catalog on change, and asks for ranked hits. Any failure (missing binary,
// dead process, timeout) resolves to null so the caller falls back to the JS
// BM25 index.

import { spawn, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import type { Logger } from './types.js'

interface Pending {
  resolve: (msg: SidecarMsg | null) => void
  timer: NodeJS.Timeout
}

interface SidecarMsg {
  id?: number
  ok?: boolean
  error?: string
  hits?: { id: number; score: number }[]
  [key: string]: unknown
}

export interface SidecarOptions {
  bin: string
  socket: string
  timeoutMs?: number
  logger?: Logger
}

export class Sidecar {
  private bin: string
  private socket: string
  private timeoutMs: number
  private logger?: Logger
  private child: ChildProcess | null = null
  private sock: Socket | null = null
  private buf = ''
  private pending = new Map<number, Pending>()
  private nextId = 1
  private ready = false

  constructor({ bin, socket, timeoutMs = 2000, logger }: SidecarOptions) {
    this.bin = bin
    this.socket = socket
    this.timeoutMs = timeoutMs
    this.logger = logger
  }

  async start(): Promise<boolean> {
    if (!existsSync(this.bin)) {
      this.logger?.warn?.(`tool-router: sidecar binary not found at ${this.bin}; using JS BM25`)
      return false
    }
    try {
      this.child = spawn(this.bin, ['--socket', this.socket], { stdio: ['ignore', 'ignore', 'pipe'] })
      this.child.stderr?.on('data', (d) => this.logger?.debug?.(`tool-router sidecar: ${String(d).trim()}`))
      this.child.on('exit', (code) => {
        this.logger?.warn?.(`tool-router: sidecar exited (code ${code}); falling back to JS BM25`)
        this.ready = false
        this.sock?.destroy()
        this.sock = null
      })
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          await this._connect()
          break
        } catch {
          await new Promise((r) => setTimeout(r, 100))
        }
      }
      if (!this.sock) { this.logger?.warn?.('tool-router: sidecar start: no socket after connect loop'); return false }
      const pong = await this._request({ op: 'ping' })
      if (!pong?.ok) { this.logger?.warn?.(`tool-router: sidecar start: ping failed: ${JSON.stringify(pong)}`); return false }
      this.ready = true
      this.logger?.info?.('tool-router: Rust sidecar active (tantivy BM25)')
      return true
    } catch (caught) {
      this.logger?.warn?.(`tool-router: sidecar start failed: ${caught instanceof Error ? caught.message : String(caught)}`)
      return false
    }
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = connect({ path: this.socket })
      s.once('connect', () => {
        this.sock = s
        s.setEncoding('utf8')
        s.on('data', (chunk) => this._onData(chunk as unknown as string))
        s.on('close', () => { this.ready = false; this.sock = null })
        s.on('error', () => {})
        resolve()
      })
      s.once('error', reject)
    })
  }

  private _onData(chunk: string): void {
    this.buf += chunk
    let idx
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 1)
      if (!line.trim()) continue
      let msg: SidecarMsg
      try { msg = JSON.parse(line) as SidecarMsg } catch { continue }
      const id = msg.id
      if (id === undefined) continue
      const p = this.pending.get(id)
      if (!p) continue
      this.pending.delete(id)
      clearTimeout(p.timer)
      p.resolve(msg)
    }
  }

  private _request(msg: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<SidecarMsg | null> {
    // Only gate on the socket, not on this.ready: the ping is what sets ready,
    // so gating on ready would make the ping itself unreachable. this.sock is
    // kept in sync with the connection lifecycle (set on connect, nulled on
    // close/exit/stop), so it is the correct liveness check.
    if (!this.sock) return Promise.resolve(null)
    const sock = this.sock
    const id = this.nextId++
    msg.id = id
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      sock.write(JSON.stringify(msg) + '\n')
    })
  }

  async index(name: string, docs: { ref: unknown; text: string }[]): Promise<boolean> {
    if (!this.ready) return false
    const res = await this._request({ op: 'index', name, docs })
    if (res?.ok) return true
    this.logger?.warn?.(`tool-router: sidecar index ${name} failed: ${res?.error ?? 'no response'}`)
    return false
  }

  async search(index: string, query: string, limit: number): Promise<{ id: number; score: number }[] | null> {
    if (!this.ready) return null
    const res = await this._request({ op: 'search', index, query, limit })
    if (!res?.ok) return null
    return res.hits ?? null
  }

  stop(): void {
    try { this.sock?.destroy() } catch { /* ignore */ }
    this.sock = null
    try { this.child?.kill() } catch { /* ignore */ }
    this.child = null
    this.ready = false
  }
}