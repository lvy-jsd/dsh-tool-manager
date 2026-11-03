/**
 * Which existing files a tool may read. Default deny: only the output folder
 * and the folders listed in `inputDirs`, checked after resolving links, so a
 * symlink or `..` cannot reach anything else.
 */
import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, sep } from 'node:path'

async function realOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Absolute path of a file inside the output folder; anything that resolves elsewhere is refused. */
export async function resolveOutputFile(outputDir: string, name: string): Promise<string> {
  return resolveInputFile({ outputDir, inputDirs: [] }, name)
}

export interface InputFolders {
  outputDir: string
  inputDirs: string[]
}

/**
 * A bare file name is looked up in the output folder; an absolute path must
 * resolve inside the output folder or one of `inputDirs`.
 */
export async function resolveInputFile(folders: InputFolders, value: string): Promise<string> {
  const text = String(value ?? '').trim()
  const bare = text !== '' && basename(text) === text
  if (!bare && !isAbsolute(text)) throw new Error(`"${text}" must be a file name from the output folder or an absolute path.`)
  const path = await realOrNull(bare ? join(folders.outputDir, text) : text)
  if (!path) throw new Error(`No file at "${text}".`)
  for (const dir of [folders.outputDir, ...folders.inputDirs]) {
    const root = await realOrNull(dir)
    if (root && isInside(path, root) && path !== root) return path
  }
  throw new Error(`"${text}" is not inside the output folder or an allowed input folder.`)
}
