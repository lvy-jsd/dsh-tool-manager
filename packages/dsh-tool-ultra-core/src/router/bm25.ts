// A small, dependency-free BM25 index. It is the always-available baseline:
// ranked retrieval that needs no model, no network, and no sidecar process.

import type { Hit } from './types.js'

export function tokenize(text: string): string[] {
  const out: string[] = []
  const flat = String(text ?? '').toLowerCase()
  for (const m of flat.matchAll(/[a-z0-9_]+/g)) out.push(m[0])
  for (const ch of flat) if ((ch.codePointAt(0) ?? 0) > 0x2e7f) out.push(ch)
  return out
}

interface Doc {
  id: number
  ref: unknown
  tf: Map<string, number>
  len: number
}

export class Bm25<T> {
  private k1: number
  private b: number
  private docs: Doc[] = []
  private df = new Map<string, number>()
  private avgLen = 0
  private n = 0

  constructor({ k1 = 1.5, b = 0.75 }: { k1?: number; b?: number } = {}) {
    this.k1 = k1
    this.b = b
  }

  build(docs: { ref: T; text: string }[]): void {
    this.docs = docs.map((d, i) => {
      const tokens = tokenize(d.text)
      const tf = new Map<string, number>()
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
      return { id: i, ref: d.ref, tf, len: tokens.length }
    })
    this.df = new Map()
    for (const doc of this.docs) for (const term of doc.tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1)
    this.n = this.docs.length
    this.avgLen = this.n ? this.docs.reduce((s, d) => s + d.len, 0) / this.n : 0
  }

  private idf(term: string): number {
    const df = this.df.get(term) ?? 0
    return Math.log((this.n - df + 0.5) / (df + 0.5) + 1)
  }

  search(query: string, limit = 8): Hit<T>[] {
    const terms = [...new Set(tokenize(query))]
    if (!terms.length || !this.n) return []
    const scored: Hit<T>[] = []
    for (const doc of this.docs) {
      let score = 0
      for (const term of terms) {
        const tf = doc.tf.get(term) ?? 0
        if (!tf) continue
        score += this.idf(term) * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (doc.len / (this.avgLen || 1))))
      }
      if (score > 0) scored.push({ ref: doc.ref as T, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  }
}