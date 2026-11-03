/** One-time downloads into the model cache: size-capped, checked against a SHA-256, written atomically. */
import { createHash } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type Download = (url: string, maxBytes: number) => Promise<Buffer>

export const download: Download = async (url, maxBytes) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw new Error(`the file is ${length} bytes, over the ${maxBytes}-byte limit`)
  return Buffer.from(await response.arrayBuffer())
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Downloads `url` and refuses anything but the expected file. */
export async function fetchVerified(url: string, expectedSha256: string, maxBytes: number, fetchBytes: Download): Promise<Buffer> {
  const bytes = await fetchBytes(url, maxBytes)
  if (sha256(bytes) !== expectedSha256) throw new Error(`the file at ${url} is not the expected one (SHA-256 mismatch)`)
  return bytes
}

/** Writes beside the target first, so a crash never leaves a half-written file under the real name. */
export async function writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.part`, bytes)
  await rename(`${path}.part`, path)
}
