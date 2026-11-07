/**
 * Tool Ultra Database pack: DuckDB integration.
 * In-memory OLAP analytics, zero-copy querying of CSV/Parquet files directly via SQL.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import duckdb from 'duckdb'

export const name = 'tool-ultra-pack-db'
export const inject = ['tools']

export interface Config {
  disable?: string[]
  maxRows?: number
  readOnly?: boolean
}

export const TOOL_NAMES = ['db_query', 'db_load_file'] as const

const DEFAULTS = {
  maxRows: 500,
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: String(value) }],
} as const

/** Each query owns its database; completion includes both asynchronous close callbacks. */
export async function runQuery(sql: string, maxRows = DEFAULTS.maxRows): Promise<string> {
  let db!: duckdb.Database
  const opened = new Promise<void>((resolve, reject) => {
    db = new duckdb.Database(':memory:', (err) => err ? reject(err) : resolve())
  })

  try {
    try {
      await opened
      const conn = db.connect()
      try {
        // Keep serialization outside the native callback: JS errors must reject,
        // not escape through N-API and terminate the process.
        const rows = await new Promise<duckdb.TableData>((resolve, reject) => {
          conn.all(sql, (err: Error | null, rows: duckdb.TableData) => {
            if (err) reject(err)
            else resolve(rows)
          })
        })
        if (!rows?.length) return 'Query returned 0 rows.'

        const count = rows.length
        const truncated = rows.slice(0, maxRows)
        const summary = count > maxRows ? `\n[Showing ${maxRows} of ${count} total rows]` : ''
        const replacer = (_key: string, value: unknown) => (typeof value === 'bigint' ? Number(value) : value)
        return JSON.stringify(truncated, replacer, 2) + summary
      } finally {
        await new Promise<void>((resolve, reject) => {
          conn.close((err) => err ? reject(err) : resolve())
        })
      }
    } finally {
      // Closing just the connection leaves the database's external-file cache
      // alive. Always close the database too, even if connection cleanup fails.
      if (db) {
        await new Promise<void>((resolve, reject) => {
          db.close((err) => err ? reject(err) : resolve())
        })
      }
    }
  } catch (err) {
    throw new Error(`[DuckDB Execution Error] ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function createTools(config: Config = {}) {
  const maxRows = config.maxRows ?? DEFAULTS.maxRows

  return [
    {
      name: 'db_query' as const,
      description:
        'Execute analytical SQL queries in-memory using DuckDB. Supports ANSI SQL, aggregations, window functions, and directly querying files (e.g., SELECT * FROM "data.parquet" or read_csv_auto("file.csv")).',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: 'SQL statement to execute.',
        },
      },
      async execute(args: { query: string }): Promise<string> {
        if (!args.query || !args.query.trim()) {
          throw new Error('Query parameter cannot be empty.')
        }
        return await runQuery(args.query, maxRows)
      },
    },
    {
      name: 'db_load_file' as const,
      description:
        'Inspect, query, and describe a CSV or Parquet data file into DuckDB. Returns schema metadata, columns, types, and the first few sample rows without loading the whole file into context.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Local file path to a .csv, .parquet, or .json file.',
        },
      },
      async execute(args: { path: string }): Promise<string> {
        if (!args.path || !args.path.trim()) {
          throw new Error('File path cannot be empty.')
        }

        const sanitizedPath = args.path.replace(/'/g, "''")
        const ext = args.path.toLowerCase()

        let tableExpr = `'${sanitizedPath}'`
        if (ext.endsWith('.csv')) {
          tableExpr = `read_csv_auto('${sanitizedPath}')`
        } else if (ext.endsWith('.parquet')) {
          tableExpr = `read_parquet('${sanitizedPath}')`
        } else if (ext.endsWith('.json')) {
          tableExpr = `read_json_auto('${sanitizedPath}')`
        }

        const describeSql = `DESCRIBE SELECT * FROM ${tableExpr}`
        const sampleSql = `SELECT * FROM ${tableExpr} LIMIT 5`

        try {
          const schemaInfo = await runQuery(describeSql, 50)
          const sampleRows = await runQuery(sampleSql, 5)

          return [
            `File: ${args.path}`,
            'Schema:',
            schemaInfo,
            '',
            'Sample (First 5 Rows):',
            sampleRows,
          ].join('\n')
        } catch (err: any) {
          throw new Error(`[DuckDB File Load Error] Could not load or describe file "${args.path}": ${err.message}`)
        }
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
          id: 'db',
          title: 'Database & Data Analysis',
          summary: 'In-memory DuckDB queries, fast Parquet/CSV scanning, and data aggregation.',
          source: '@lvy-jsd/dsh-tool-ultra-pack-db',
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
