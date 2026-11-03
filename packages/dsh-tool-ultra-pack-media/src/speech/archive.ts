/**
 * Unpacks the .tar.bz2 archives speech models ship in, in memory and in
 * plain JavaScript (seek-bzip, MIT), so the server needs no tar or bzip2.
 * Only the files asked for are kept.
 */
import Bunzip from 'seek-bzip'

const BLOCK = 512

function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length)
  const end = raw.indexOf(0)
  return raw.subarray(0, end < 0 ? length : end).toString('utf8')
}

/** ustar headers: name, size (octal) and a name prefix for long paths. */
function entryOf(header: Buffer): { name: string; size: number; type: string } {
  const prefix = field(header, 345, 155)
  const name = field(header, 0, 100)
  return { name: prefix ? `${prefix}/${name}` : name, size: parseInt(field(header, 124, 12).trim() || '0', 8), type: field(header, 156, 1) }
}

/** Regular files of a tar archive whose base names are in `wanted`, by base name. */
export function untar(tar: Buffer, wanted: Set<string>): Map<string, Buffer> {
  const found = new Map<string, Buffer>()
  for (let at = 0; at + BLOCK <= tar.length;) {
    const header = tar.subarray(at, at + BLOCK)
    if (header.every((byte) => byte === 0)) break
    const { name, size, type } = entryOf(header)
    const base = name.split('/').pop() ?? ''
    if ((type === '0' || type === '') && wanted.has(base)) found.set(base, tar.subarray(at + BLOCK, at + BLOCK + size))
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK
  }
  return found
}

export function unpackTarBz2(archive: Buffer, wanted: string[]): Map<string, Buffer> {
  const files = untar(Bunzip.decode(archive), new Set(wanted))
  const missing = wanted.filter((name) => !files.has(name))
  if (missing.length) throw new Error(`the archive has no ${missing.join(', ')}`)
  return files
}
