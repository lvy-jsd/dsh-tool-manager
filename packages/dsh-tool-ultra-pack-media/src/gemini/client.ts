import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { redactKey } from './settings.js'

const ORIGIN = 'https://generativelanguage.googleapis.com'
const API = `${ORIGIN}/v1beta`
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3
const UPLOAD_BYTES_PER_SECOND = 125_000
const UPLOAD_FLOOR_MS = 120_000
const PROCESSING_TIMEOUT_MS = 600_000
const GENERATION_TIMEOUT_MS = 300_000
const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.webm': 'video/webm',
  '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
}

export type GeminiFailure = 'network' | 'timeout' | 'failed' | 'invalid' | 'uploadUrl' | 'model' | 'mime' | 'tooLarge'

export class GeminiError extends Error {
  constructor(public readonly reason: GeminiFailure, public readonly status?: number) {
    super(status ? `HTTP ${status}` : reason)
  }
}

interface RemoteFile {
  name: string
  uri?: string
  state?: string
}

export interface GeminiOptions {
  uploadTimeoutMs?: number
  processingTimeoutMs?: number
  generationTimeoutMs?: number
  pollMs?: number
  responseJsonSchema?: Record<string, unknown>
}

/** Bounds both fetch and response-body reads; never exposes fetch errors or server error bodies. */
async function request<T>(
  url: string,
  key: string,
  deadline: number,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    throw new GeminiError('timeout')
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new GeminiError('timeout'))
    }, remainingMs)
  })
  const send = async () => {
    const headers = new Headers(init.headers)
    headers.set('x-goog-api-key', key)
    const response = await fetch(url, { ...init, headers, signal: controller.signal, redirect: 'error' })
    if (!response.ok) {
      throw new GeminiError('network', response.status)
    }
    return read(response)
  }
  try {
    return await Promise.race([send(), expired])
  } catch (error) {
    if (error instanceof GeminiError) {
      throw error
    }
    throw new GeminiError(controller.signal.aborted ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
  }
}

function uploadAddress(value: string | null): string {
  try {
    const url = new URL(value ?? '')
    const allowedEndpoint = url.origin === ORIGIN && url.pathname === '/upload/v1beta/files'
    const hasCredentials = Boolean(url.username || url.password || url.searchParams.has('key'))
    if (allowedEndpoint && !hasCredentials) {
      return url.href
    }
  } catch {
    // A missing or malformed address is also refused before sending credentials.
  }
  throw new GeminiError('uploadUrl')
}

function fileName(value: unknown): string {
  if (typeof value !== 'string' || !/^files\/[a-zA-Z0-9_-]+$/.test(value)) {
    throw new GeminiError('invalid')
  }
  return value
}

async function upload(path: string, mime: string, key: string, options: GeminiOptions): Promise<RemoteFile> {
  const size = (await stat(path)).size
  if (size > MAX_UPLOAD_BYTES) {
    throw new GeminiError('tooLarge')
  }
  // 1 Mbps uplink, plus time for setup and ordinary connection overhead.
  const transferMs = Math.ceil(size / UPLOAD_BYTES_PER_SECOND * 1000)
  const uploadTimeoutMs = options.uploadTimeoutMs ?? UPLOAD_FLOOR_MS + transferMs
  const deadline = Date.now() + uploadTimeoutMs
  const url = await request(`${ORIGIN}/upload/v1beta/files`, key, deadline, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mime,
    },
    body: JSON.stringify({ file: { display_name: 'media' } }),
  }, async (response) => uploadAddress(response.headers.get('x-goog-upload-url')))
  const body = await openAsBlob(path, { type: mime })
  const result = await request(url, key, deadline, {
    method: 'POST',
    headers: {
      'Content-Length': String(size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body,
  }, (response) => response.json())
  return result.file
}

async function waitForFile(name: string, key: string, deadline: number, pollMs: number): Promise<RemoteFile> {
  while (Date.now() < deadline) {
    const file = await request<RemoteFile>(`${API}/${name}`, key, deadline, { method: 'GET' }, (response) => response.json())
    if (file.state === 'FAILED') {
      throw new GeminiError('failed')
    }
    if (file.state === 'ACTIVE' && typeof file.uri === 'string') {
      return file
    }
    await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())))
  }
  throw new GeminiError('timeout')
}

interface Candidate {
  finishReason?: string
  content?: {
    parts?: {
      thought?: boolean
      text?: string
    }[]
  }
}

function generatedText(candidate: Candidate | undefined): string {
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new GeminiError('invalid')
  }
  const parts = candidate?.content?.parts ?? []
  const visible = parts.filter((part) => !part.thought && typeof part.text === 'string')
  const text = visible.map((part) => part.text).join('\n')
  if (!text.trim()) {
    throw new GeminiError('invalid')
  }
  return text
}

async function generate(
  file: RemoteFile,
  mime: string,
  prompt: string,
  model: string,
  key: string,
  options: GeminiOptions,
): Promise<string> {
  const deadline = Date.now() + (options.generationTimeoutMs ?? GENERATION_TIMEOUT_MS)
  const parts = [
    { file_data: { mime_type: mime, file_uri: file.uri } },
    { text: prompt },
  ]
  const generationConfig = options.responseJsonSchema ? {
    responseMimeType: 'application/json',
    responseJsonSchema: options.responseJsonSchema,
  } : undefined
  const result = await request(`${API}/models/${model}:generateContent`, key, deadline, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
  }, (response) => response.json())
  return generatedText(result.candidates?.[0])
}

/** One upload per invocation, removed even when polling or generation fails. */
export async function analyseGemini(
  path: string,
  prompt: string,
  model: string,
  key: string,
  options: GeminiOptions = {},
): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new GeminiError('model')
  }
  const mime = MIME_TYPES[extname(path).toLowerCase()]
  if (!mime) {
    throw new GeminiError('mime')
  }
  let name: string | undefined
  try {
    const uploaded = await upload(path, mime, key, options)
    name = fileName(uploaded?.name)
    const deadline = Date.now() + (options.processingTimeoutMs ?? PROCESSING_TIMEOUT_MS)
    const file = await waitForFile(name, key, deadline, options.pollMs ?? 1000)
    const text = await generate(file, mime, prompt, model, key, options)
    return redactKey(text, key)
  } catch (error) {
    if (error instanceof GeminiError) {
      throw error
    }
    throw new GeminiError('invalid')
  } finally {
    if (name) {
      await request(`${API}/${name}`, key, Date.now() + 5000, { method: 'DELETE' }, async () => undefined).catch(() => undefined)
    }
  }
}
