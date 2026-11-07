// Database pack unit tests: DuckDB SQL execution, in-memory analytics, and error wrapping.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises'
import duckdb from 'duckdb'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTools,
  apply,
  TOOL_NAMES,
  runQuery,
} from '../../packages/dsh-tool-ultra-pack-db/lib/index.js'

test('db: query settlement awaits connection and database close on success and error', async (t) => {
  const events = []
  const Database = duckdb.Database
  t.mock.method(duckdb, 'Database', function (...args) {
    const db = new Database(...args)
    return {
      connect() {
        const conn = db.connect()
        return {
          all: conn.all.bind(conn),
          close(callback) {
            events.push('connection:start')
            conn.close((err) => setImmediate(() => {
              events.push('connection:done')
              callback(err)
            }))
          },
        }
      },
      close(callback) {
        events.push('database:start')
        db.close((err) => setImmediate(() => {
          events.push('database:done')
          callback(err)
        }))
      },
    }
  })

  for (const sql of ['SELECT 1 AS ok', 'SELECT FROM SYNTAX ERROR']) {
    events.length = 0
    if (sql.includes('SYNTAX')) await assert.rejects(runQuery(sql), /DuckDB Execution Error/)
    else assert.match(await runQuery(sql), /"ok": 1/)
    assert.deepEqual(events, ['connection:start', 'connection:done', 'database:start', 'database:done'])
  }
})

test('db: database closes even if connection cleanup reports an error', async (t) => {
  const Database = duckdb.Database
  let databaseClosed = false
  t.mock.method(duckdb, 'Database', function (...args) {
    const db = new Database(...args)
    return {
      connect() {
        const conn = db.connect()
        return {
          all: conn.all.bind(conn),
          close(callback) {
            conn.close(() => callback(new Error('injected close failure')))
          },
        }
      },
      close(callback) {
        db.close((err) => {
          databaseClosed = !err
          callback(err)
        })
      },
    }
  })
  await assert.rejects(runQuery('SELECT 1'), /DuckDB Execution Error.*injected close failure/)
  assert.equal(databaseClosed, true)
})

test('db: every tool is declared in package.json toolCatalog', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../packages/dsh-tool-ultra-pack-db/package.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(pkg.dsh.toolCatalog.tools).sort(), [...TOOL_NAMES].sort())
  assert.deepEqual(createTools().map((t) => t.name).sort(), [...TOOL_NAMES].sort())
})

test('db: apply registers tools minus disabled ones', () => {
  const registered = []
  apply({ tools: { register: (d) => registered.push(d.name ?? d.schema?.name) } }, { disable: ['db_load_file'] })
  assert.equal(registered.length, 1)
  assert.equal(registered[0], 'db_query')
})

test('db: db_query runs analytical SQL queries and formats output', async () => {
  const tools = createTools()
  const queryTool = tools.find((t) => t.name === 'db_query')

  // Scalar arithmetic query
  const res1 = await queryTool.execute({ query: 'SELECT 40 + 2 AS answer, CURRENT_DATE AS today' })
  assert.match(res1, /"answer": 42/)

  // Aggregation & window functions query
  const res2 = await queryTool.execute({
    query: 'SELECT x, sum(x) OVER (ORDER BY x) AS running_total FROM range(1, 4) t(x)',
  })
  assert.match(res2, /"running_total": 6/)

  // Empty query validation
  await assert.rejects(
    queryTool.execute({ query: '   ' }),
    /Query parameter cannot be empty/,
  )

  // Unified error handling on syntax errors
  await assert.rejects(
    queryTool.execute({ query: 'SELECT FROM SYNTAX ERROR' }),
    /\[DuckDB Execution Error\]/,
  )
})

test('db: db_load_file inspects and queries CSV files directly', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'db-test-'))
  try {
    const csvFile = join(temp, 'users.csv')
    const csvContent = 'id,name,role,score\n1,Alice,engineer,95\n2,Bob,designer,88\n3,Charlie,manager,92\n'
    await writeFile(csvFile, csvContent)

    const tools = createTools()
    const loadTool = tools.find((t) => t.name === 'db_load_file')

    const out = await loadTool.execute({ path: csvFile })
    assert.match(out, /File: .*users\.csv/)
    assert.match(out, /column_name/)
    assert.match(out, /score/)
    assert.match(out, /Alice/)

    // Direct query against CSV file via SQL
    const queryTool = tools.find((t) => t.name === 'db_query')
    const avgScore = await queryTool.execute({
      query: `SELECT avg(score) AS avg_score FROM read_csv_auto('${csvFile}')`,
    })
    assert.match(avgScore, /"avg_score": 91\.666/)

    // No retry, GC request, or sleep: tool completion must release Windows locks.
    await unlink(csvFile)
    await writeFile(csvFile, csvContent.replace('Alice', 'Diana'))
    assert.match(await loadTool.execute({ path: csvFile }), /Diana/)
    await unlink(csvFile)

    // A query that opens a dataset and then fails must release it as well.
    await writeFile(csvFile, 'value\nnot_an_integer\n')
    await assert.rejects(queryTool.execute({
      query: `SELECT CAST(value AS INTEGER) FROM read_csv_auto('${csvFile}')`,
    }), /DuckDB Execution Error/)
    await unlink(csvFile)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
