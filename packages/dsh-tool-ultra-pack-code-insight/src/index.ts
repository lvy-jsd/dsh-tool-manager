/**
 * Tool Ultra Code Insight pack:
 * JavaScript / TypeScript structural outlines, symbols and module imports only.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile, lstat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { extractOutline, detectLanguage, type CodeOutlineResult, type SymbolItem } from './parser.js'

export {
  extractOutline,
  detectLanguage,
  type CodeOutlineResult,
  type SymbolItem,
}

export const name = 'tool-ultra-pack-code-insight'
export const inject = ['tools']

export interface Config {
  disable?: string[]
  maxDepth?: number
  maxSymbols?: number
}

export const TOOL_NAMES = ['code_outline', 'code_symbols', 'code_callgraph'] as const

const DEFAULTS = {
  maxDepth: 3,
  maxSymbols: 200,
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

function formatSymbol(sym: SymbolItem, indent = 0, maxDepth = 3): string {
  if (indent >= maxDepth) return ''
  const pad = '  '.repeat(indent)
  const lineStr = `(L${sym.line})`
  const sig = sym.signature || `${sym.kind} ${sym.name}`
  let out = `${pad}- ${lineStr} ${sig}\n`

  if (sym.children && sym.children.length > 0 && indent + 1 < maxDepth) {
    for (const child of sym.children) {
      out += formatSymbol(child, indent + 1, maxDepth)
    }
  }
  return out
}

async function readSource(path: string): Promise<string> {
  const info = await lstat(path)
  if (!info.isFile() || info.size > 2_000_000) throw new Error('Expected a regular source file up to 2 MB; symlinks are not followed.')
  return readFile(path, 'utf8')
}

export function createTools(config: Config = {}) {
  const defaultDepth = config.maxDepth ?? DEFAULTS.maxDepth
  const defaultMaxSymbols = config.maxSymbols ?? DEFAULTS.maxSymbols

  return [
    {
      name: 'code_outline' as const,
      description:
        'Extract a clean structural AST outline of a source code file (classes, functions, methods, interfaces, imports, exports) omitting function bodies from output. Only JavaScript / TypeScript is supported; not semantic resolution.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Local file path to the source file.',
        },
        max_depth: {
          type: 'integer',
          description: `Maximum depth of nested symbols to show (default: ${defaultDepth}).`,
        },
      },
      async execute(args: { path: string; max_depth?: number }): Promise<string> {
        if (!args.path || !args.path.trim()) {
          throw new Error('File path cannot be empty.')
        }
        if (!existsSync(args.path)) {
          throw new Error(`[Code Insight Error] File not found: "${args.path}"`)
        }

        try {
          if (detectLanguage(args.path) === 'generic') throw new Error('Only JavaScript / TypeScript files are supported.')
          const code = await readSource(args.path)
          const depth = args.max_depth ?? defaultDepth
          if (!Number.isInteger(depth) || depth < 1 || depth > 10) throw new Error('max_depth must be 1–10.')
          const outline = extractOutline(code, args.path)

          const lines: string[] = [
            `Outline: ${outline.filename} (${outline.language})`,
            '',
          ]

          if (outline.imports.length > 0) {
            lines.push(`Imports (${outline.imports.length}):`)
            for (const imp of outline.imports.slice(0, 20)) {
              lines.push(`  import ${imp}`)
            }
            if (outline.imports.length > 20) {
              lines.push(`  ... and ${outline.imports.length - 20} more imports`)
            }
            lines.push('')
          }

          if (outline.exports.length > 0) {
            lines.push(`Exports (${outline.exports.length}):`)
            for (const exp of outline.exports) {
              lines.push(`  export ${exp}`)
            }
            lines.push('')
          }

          lines.push(`Symbols (${outline.symbols.length}):`)
          if (outline.symbols.length === 0) {
            lines.push('  (no top-level classes or functions detected)')
          } else {
            for (const sym of outline.symbols) {
              lines.push(formatSymbol(sym, 0, depth).trimEnd())
            }
          }

          return lines.join('\n')
        } catch (err: any) {
          throw new Error(`[Code Insight Error] Failed to generate outline for "${args.path}": ${err.message}`)
        }
      },
    },
    {
      name: 'code_symbols' as const,
      description:
        'List JavaScript / TypeScript declaration names in a file or directory. Parses source locally; returns signatures, not bodies.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Path to a file or directory.',
        },
        query: {
          type: 'string',
          description: 'Optional name filter to search for specific symbols.',
        },
      },
      async execute(args: { path: string; query?: string }): Promise<string> {
        if (!args.path || !args.path.trim()) {
          throw new Error('Path cannot be empty.')
        }
        if (!existsSync(args.path)) {
          throw new Error(`[Code Insight Error] Path not found: "${args.path}"`)
        }

        const files: string[] = []
        async function collect(p: string, depth = 0) {
          if (depth > 12) throw new Error('Directory depth limit (12) exceeded. Narrow the path.')
          const s = await lstat(p)
          if (s.isDirectory()) {
            const entries = (await readdir(p)).sort()
            for (const e of entries) {
              if (['node_modules', '.git', 'dist', 'build', '.cache'].includes(e)) continue
              await collect(join(p, e), depth + 1)
            }
          } else if (s.isFile()) {
            const lang = detectLanguage(p)
            if (lang !== 'generic') {
              if (files.length >= 50) throw new Error('File limit (50) exceeded. Narrow the path.')
              files.push(p)
            }
          }
        }

        if ((await lstat(args.path)).isFile() && detectLanguage(args.path) === 'generic') throw new Error('Only JavaScript / TypeScript files are supported.')
        await collect(args.path)

        const q = args.query?.toLowerCase()
        const found: { file: string; symbol: SymbolItem }[] = []

        function searchSymbols(file: string, items: SymbolItem[]) {
          for (const item of items) {
            if (!q || item.name.toLowerCase().includes(q)) {
              found.push({ file, symbol: item })
            }
            if (item.children) searchSymbols(file, item.children)
          }
        }

        for (const f of files.slice(0, 50)) {
          try {
            const content = await readSource(f)
            const outline = extractOutline(content, f)
            searchSymbols(f, outline.symbols)
          } catch {
            throw new Error(`Cannot parse JavaScript / TypeScript file: ${f}`)
          }
        }

        if (found.length === 0) {
          return `No symbols found${q ? ` matching "${q}"` : ''} in ${args.path}.`
        }

        const count = found.length
        const display = found.slice(0, defaultMaxSymbols)
        const lines = [
          `Found ${count} symbol(s)${q ? ` matching "${q}"` : ''}:`,
          '',
        ]

        for (const item of display) {
          lines.push(`- [${item.symbol.kind}] ${item.symbol.name} -> ${item.file}:${item.symbol.line}`)
        }

        if (count > defaultMaxSymbols) {
          lines.push(`\n[... truncated ${count - defaultMaxSymbols} additional symbols]`)
        }
        return lines.join('\n')
      },
    },
    {
      name: 'code_callgraph' as const,
      description:
        'List static JavaScript / TypeScript module imports. This is NOT a function call graph or resolved cross-file dependency graph.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Path to source file or project folder.',
        },
      },
      async execute(args: { path: string }): Promise<string> {
        if (!args.path || !args.path.trim()) {
          throw new Error('Path cannot be empty.')
        }
        if (!existsSync(args.path)) {
          throw new Error(`[Code Insight Error] Path not found: "${args.path}"`)
        }

        let visitedFiles = 0
        const fileGraph: { file: string; imports: string[] }[] = []

        async function collect(p: string, depth = 0) {
          if (depth > 12) throw new Error('Directory depth limit (12) exceeded. Narrow the path.')
          const s = await lstat(p)
          if (s.isDirectory()) {
            const entries = (await readdir(p)).sort()
            for (const e of entries) {
              if (['node_modules', '.git', 'dist', 'build', '.cache'].includes(e)) continue
              await collect(join(p, e), depth + 1)
            }
          } else if (s.isFile()) {
            const lang = detectLanguage(p)
            if (lang !== 'generic') {
              if (++visitedFiles > 50) throw new Error('File limit (50) exceeded. Narrow the path.')
              try {
                const code = await readSource(p)
                const outline = extractOutline(code, p)
                if (outline.imports.length > 0) {
                  fileGraph.push({ file: p, imports: outline.imports })
                }
              } catch {
                throw new Error(`Cannot parse JavaScript / TypeScript file: ${p}`)
              }
            }
          }
        }

        if ((await lstat(args.path)).isFile() && detectLanguage(args.path) === 'generic') throw new Error('Only JavaScript / TypeScript files are supported.')
        await collect(args.path)

        if (fileGraph.length === 0) {
          return `No module dependency graph found for ${args.path}.`
        }

        const lines = [`Dependency Graph (${fileGraph.length} modules):`, '']
        for (const item of fileGraph.slice(0, 40)) {
          lines.push(`Module: ${item.file}`)
          for (const imp of item.imports.slice(0, 10)) {
            lines.push(`  -> ${imp}`)
          }
          if (item.imports.length > 10) {
            lines.push(`  ... and ${item.imports.length - 10} more imports`)
          }
          lines.push('')
        }

        return lines.join('\n')
      },
    },
  ]
}

export function apply(ctx: any, config: Config = {}) {
  const disabled = new Set(config.disable ?? [])

  if (typeof ctx.inject === 'function') {
    ctx.inject(['toolCatalog'], (c: any) => {
      if (typeof c.toolCatalog?.registerToolPack !== 'function') return
      c.effect(() =>
        c.toolCatalog.registerToolPack({
          id: 'code-insight',
          title: 'Code Insight & Outline',
          summary: 'JavaScript / TypeScript structural outlines, symbols and static module imports only.',
          source: '@lvy-jsd/dsh-tool-ultra-pack-code-insight',
          tools: TOOL_NAMES.filter((n) => !disabled.has(n)),
        }),
      )
    })
  }

  for (const spec of createTools(config)) {
    if (disabled.has(spec.name)) continue
    ctx.tools.register(
      defineTool({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: TEXT_OUTPUT,
        isConcurrencySafe: () => true,
        execute: (args: unknown) => spec.execute(args as any),
      } as any),
    )
  }
}
