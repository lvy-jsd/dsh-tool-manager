/**
 * Tool Ultra Database pack: DuckDB integration.
 * Embedded SQL analytics with bounded result reading and explicit native cleanup.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DuckDBInstance } from '@duckdb/node-api'

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

/** A query owns its result, connection and database, released in that order. */
export async function runQuery(sql: string, maxRows = DEFAULTS.maxRows): Promise<string> {
  try {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 10000) {
      throw new Error('maxRows must be an integer between 1 and 10000.')
    }
    const db = await DuckDBInstance.create(':memory:')
    try {
      const conn = await db.connect()
      try {
        // Do not use runAndReadAll: a large CSV must not become a full JS array.
        // Keep the reader before fetching, so even read/conversion failures close it.
        const reader = await conn.streamAndRead(sql)
        try {
          await reader.readUntil(maxRows + 1)
          const rows = reader.getRowObjectsJson()
          if (!rows.length) return 'Query returned 0 rows.'
          const more = !reader.done || rows.length > maxRows
          const summary = more ? `\n[Showing first ${maxRows} rows; additional rows omitted]` : ''
          return JSON.stringify(rows.slice(0, maxRows), null, 2) + summary
        } finally {
          reader.closeSync()
        }
      } finally {
        conn.closeSync()
      }
    } finally {
      db.closeSync()
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
