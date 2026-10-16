// dsh-tool-manager-classifier-llm: place groups with a small model, cached.
//
// The directory has to be stable: a category that changes between sessions
// invalidates paths the model memorised and costs another cache miss. So this
// classifier never classifies on the hot path.
//
//   - `categorize(group)` is synchronous and answers from a cache file;
//   - a miss is queued and the group stays `uncategorized` until an answer
//     lands (the plugin then calls `toolCatalog.refresh()`);
//   - answers are cached by a hash of the group name, its tool names and their
//     descriptions, so re-classification happens only when a group really
//     changed.
//
// The cache is per group, not per call, and the whole group is classified at
// once: a host with 40 groups makes ~40 small requests in total, not per turn.
//
// Model selection follows the project convention: `model: { provider, model }`.
// With no model configured, the classifier does nothing and every group stays
// `uncategorized` — the plugin is optional, and so is the model.

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { GenerateOptions, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { Classifier, ExtensionContext, HostContext, Logger } from '@lvy-jsd/dsh-tool-manager'

/** What the classifier needs of a group (a catalog Group or a GroupProbe both fit). */
export interface GroupInput {
  name: string
  tools?: { name: string, description?: string }[]
}

/** Group cache key -> category. */
export type CategoryCache = Record<string, string>

/** Returns a category name (anything else counts as no answer) or throws. */
export type ClassifyGroup = (group: GroupInput) => Promise<string | undefined> | string | undefined

export interface LlmClassifierOptions {
  name?: string
  priority?: number
  cache?: CategoryCache
  classifyGroup?: ClassifyGroup
  onBatch?(cache: CategoryCache): unknown
  batchSize?: number
  logger?: Logger
  maxPending?: number
}

export interface LlmClassifier extends Classifier {
  name: string
  priority: number
  categorize(group: GroupInput): string | undefined
  schedule(): Promise<void>
  drain(): Promise<void>
  pending(): number
  failedKeys(): string[]
}

export interface ClassifierLlmConfig {
  enabled?: boolean
  name?: string
  priority?: number
  cacheFile?: string
  /** A cache object to use instead of reading cacheFile. */
  cache?: CategoryCache
  model?: { provider?: string, model?: string }
  maxTokens?: number
  batchSize?: number
  /** Replaces the model call (tests, custom pipelines). */
  classify?: ClassifyGroup
}

export const name = 'tool-manager-classifier-llm'
export const inject = ['toolCatalog']

/** Ordinary tier: below user overrides and plugin declarations, above nothing. */
export const DEFAULT_PRIORITY = 50

/** Categories the model may choose from, mirroring the core vocabulary. */
export const CATEGORIES = [
  'device', 'code', 'media', 'maps', 'browser', 'memory',
  'collaboration', 'automation', 'connectors', 'search', 'system',
]

export function defaultCacheFile(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.config', 'deepseek-harness')
  return join(dshHome, 'tool-manager', 'classifier-cache.json')
}

/**
 * Cache key for one group. Tool names are sorted so ordering never matters, and
 * each description is hashed so a rewritten description re-classifies while an
 * unrelated tool joining the group does not re-hash the rest.
 */
export function groupKey(group: GroupInput): string {
  const parts = [...(group.tools ?? [])]
    .map((tool) => `${tool.name}:${createHash('sha1').update(String(tool.description ?? '')).digest('hex').slice(0, 12)}`)
    .sort()
  return createHash('sha1').update(`${group.name}\n${parts.join('\n')}`).digest('hex').slice(0, 16)
}

/** Read the cache; a corrupt or missing file is an empty cache, never a crash. */
export function readCache(file: string, logger?: Logger): CategoryCache {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (caught) {
    const error = caught as NodeJS.ErrnoException
    if (error.code !== 'ENOENT') logger?.warn?.(`classifier-llm: ignoring unreadable cache ${file}: ${error.message}`)
    return {}
  }
}

/** Write the cache atomically, so a crash cannot leave a half-written file. */
export function writeCache(file: string, cache: CategoryCache, logger?: Logger): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(cache, null, 2))
    renameSync(tmp, file)
  } catch (caught) {
    const error = caught as Error
    logger?.warn?.(`classifier-llm: writing cache ${file} failed: ${error.message}`)
  }
}

/** Prompt for one group: the tool list plus the fixed category vocabulary. */
export function buildPrompt(group: GroupInput): string {
  const tools = (group.tools ?? []).map((tool) => {
    const first = String(tool.description ?? '').split('\n')[0].trim().slice(0, 160)
    return `- ${tool.name}: ${first}`
  })
  return [
    'You place one group of tools from a coding agent into a single category.',
    '',
    `Group name: ${group.name}`,
    'Tools:',
    ...tools,
    '',
    `Answer with exactly one of these category names and nothing else: ${CATEGORIES.join(', ')}.`,
  ].join('\n')
}

/** Pull the first category name out of a model answer, or undefined. */
export function parseCategory(text: unknown): string | undefined {
  const value = String(text ?? '').toLowerCase()
  for (const category of CATEGORIES) {
    if (new RegExp(`(^|[^a-z])${category}([^a-z]|$)`).test(value)) return category
  }
  return undefined
}

/**
 * Build the classifier. `classifyGroup(group)` returns a category name or
 * throws; the pump calls it off the hot path and caches whatever it returns.
 */
export function createLlmClassifier({
  name: classifierName = 'llm:groups',
  priority = DEFAULT_PRIORITY,
  cache = {},
  classifyGroup,
  onBatch,
  batchSize = 5,
  logger,
  maxPending = 200,
}: LlmClassifierOptions = {}): LlmClassifier {
  const pending = new Map<string, GroupInput>()      // key -> group
  const inFlight = new Set<string>()     // keys being classified right now
  const failed = new Set<string>()       // keys that errored; not retried this process
  let pumping = false

  function categorize(group: GroupInput): string | undefined {
    const key = groupKey(group)
    const cached = cache[key]
    if (typeof cached === 'string') return cached
    // Without a way to classify, queueing would only grow forever.
    if (typeof classifyGroup !== 'function') return undefined
    if (!failed.has(key) && !inFlight.has(key) && pending.size < maxPending) pending.set(key, group)
    return undefined
  }

  async function pump(): Promise<void> {
    if (pumping || typeof classifyGroup !== 'function') return
    pumping = true
    try {
      while (pending.size > 0) {
        const batch = [...pending.entries()].slice(0, batchSize)
        for (const [key] of batch) pending.delete(key)
        let changed = false
        for (const [key, group] of batch) {
          inFlight.add(key)
          try {
            const category = await classifyGroup!(group)
            if (typeof category === 'string' && CATEGORIES.includes(category)) {
              cache[key] = category
              changed = true
            } else {
              // An unusable answer is remembered as a failure so the group is
              // not re-asked on every rebuild.
              failed.add(key)
              logger?.warn?.(`classifier-llm: no usable category for group "${group.name}"`)
            }
          } catch (caught) {
            const error = caught as Error
            failed.add(key)
            logger?.warn?.(`classifier-llm: classifying "${group.name}" failed: ${error.message}`)
          } finally {
            inFlight.delete(key)
          }
        }
        if (changed) await onBatch?.(cache)
      }
    } finally {
      pumping = false
    }
  }

  /** Start the background pump; call it after any categorize() miss. */
  function schedule(): Promise<void> {
    if (pending.size === 0 || typeof classifyGroup !== 'function') return Promise.resolve()
    return pump()
  }

  return {
    name: classifierName,
    priority,
    categorize,
    schedule,
    /** Wait for the current queue to drain (tests). */
    async drain() {
      if (typeof classifyGroup !== 'function') {
        pending.clear()
        return
      }
      while (pending.size > 0 || pumping) await pump()
    },
    pending: () => pending.size,
    failedKeys: () => [...failed],
  }
}

/**
 * One small-model call: fixed system prompt, answer read as plain text.
 *
 * The stream protocol is consumed directly instead of through the host's
 * assembler, so this package needs no import from the harness — the `llm`
 * service is enough, and a deployment without it simply stays uncategorized.
 */
export function createLlmCaller(llm: Pick<LlmRuntime, 'stream'>, { provider, model, maxTokens = 16, temperature = 0 }: { provider: string, model: string, maxTokens?: number, temperature?: number }): ClassifyGroup {
  return async function classifyGroup(group: GroupInput): Promise<string | undefined> {
    let text = ''
    let finished = false
    const options: GenerateOptions = {
      provider,
      model,
      system: 'You are a strict classifier. You answer with one word.',
      messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(group) }] }],
      maxTokens,
      temperature,
    }
    for await (const chunk of llm.stream(options)) {
      if (finished) throw new Error('the model emitted data after its finish')
      // The stream protocol carries text as deltas; block-end is ignored so a
      // provider that emits both does not double the text.
      if (chunk.type === 'text-delta') text += chunk.text ?? ''
      else if (chunk.type === 'finish') {
        finished = true
        if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
          const { code, message } = chunk.reason.failure
          throw new Error(`${chunk.reason.kind} ${code}: ${message}`)
        }
        if (chunk.reason.kind !== 'stop') throw new Error(`ended with ${chunk.reason.kind}`)
      }
    }
    if (!finished) throw new Error('the model emitted no finish chunk')
    return parseCategory(text.trim())
  }
}

export function apply(ctx: ExtensionContext & Pick<HostContext, 'get'> & { llm?: Pick<LlmRuntime, 'stream'> }, config: ClassifierLlmConfig = {}) {
  const logger = (typeof ctx.logger === 'function' ? ctx.logger('tool-manager-classifier-llm') : ctx.logger) ?? console
  if (config.enabled === false) return
  const file = config.cacheFile ?? defaultCacheFile()
  const cache = config.cache ?? readCache(file, logger)
  const target = config.model ?? {}
  const llm = (typeof ctx.get === 'function' ? ctx.get('llm') : ctx.llm) as Pick<LlmRuntime, 'stream'> | undefined

  let classifyGroup: ClassifyGroup | undefined
  if (typeof config.classify === 'function') {
    classifyGroup = config.classify   // injected for tests and custom pipelines
  } else if (llm !== undefined && target.provider && target.model) {
    classifyGroup = createLlmCaller(llm, { provider: target.provider, model: target.model, maxTokens: config.maxTokens })
  } else {
    logger.info?.('tool-manager-classifier-llm: no model configured (config.model {provider, model}); groups stay uncategorized')
  }

  // The pump runs in the background, so it can outlive the plugin (DSH is
  // shutting down, or the plugin was unloaded mid-classification). Both the
  // refresh and the cache write must be safe then.
  let live = true
  ctx.effect(() => () => { live = false }, 'tool-manager-classifier-llm.lifetime()')

  const classifier = createLlmClassifier({
    name: config.name ?? 'llm:groups',
    priority: config.priority ?? DEFAULT_PRIORITY,
    cache,
    classifyGroup,
    batchSize: config.batchSize ?? 5,
    logger,
    onBatch: async (next) => {
      writeCache(file, next, logger)
      if (!live) return
      // A new answer changes where a group belongs: rebuild so the model sees it.
      try {
        ctx.toolCatalog.refresh()
      } catch (caught) {
        const error = caught as Error
        logger.warn?.(`tool-manager-classifier-llm: refresh after classifying failed: ${error.message}`)
      }
    },
  })

  ctx.effect(() => ctx.toolCatalog.registerClassifier(classifier), 'tool-manager-classifier-llm.classifier()')

  // Misses are collected while catalogs are built; pump after the build so a
  // rebuild never waits on the network.
  ctx.effect(() => ctx.on('tool-catalog/after-rebuild', () => { void classifier.schedule() }), 'tool-manager-classifier-llm.pump()')

  return { classifier, cache, file, classify: classifyGroup }
}

export default { name, inject, apply }
