// Database pack unit tests: DuckDB SQL execution, in-memory analytics, and error wrapping.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile, rm, unlink, stat } from 'node:fs/promises'
import { DuckDBInstance, DuckDBConnection, DuckDBResultReader } from '@duckdb/node-api'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createTools,
  apply,
  TOOL_NAMES,
  runQuery,
} from '../../packages/dsh-tool-ultra-pack-db/lib/index.js'

function trackCleanup(t) {
  const events = []
  for (const [prototype, name] of [
    [DuckDBResultReader.prototype, 'result'],
    [DuckDBConnection.prototype, 'connection'],
    [DuckDBInstance.prototype, 'database'],
  ]) {
    const close = prototype.closeSync
    t.mock.method(prototype, 'closeSync', function () {
      close.call(this)
      events.push(name)
    })
  }
  return events
}

test('db: result, connection and database close before query settles', async (t) => {
  const events = trackCleanup(t)
  assert.match(await runQuery('SELECT 1 AS ok'), /"ok": 1/)
  assert.deepEqual(events, ['result', 'connection', 'database'])
  events.length = 0
  await assert.rejects(runQuery('SELECT FROM SYNTAX ERROR'), /DuckDB Execution Error/)
  assert.deepEqual(events, ['connection', 'database'])
})

test('db: read and conversion failures still close all resources', async (t) => {
  const events = trackCleanup(t)
  for (const method of ['readUntil', 'getRowObjectsJson']) {
    const failure = t.mock.method(DuckDBResultReader.prototype, method, () => {
      throw new Error('injected read failure')
    })
    events.length = 0
    await assert.rejects(runQuery('SELECT 1'), /DuckDB Execution Error.*injected read failure/)
    assert.deepEqual(events, ['result', 'connection', 'database'])
    failure.mock.restore()
  }
})

test('db: database closes even if connection cleanup reports an error', async (t) => {
  const events = trackCleanup(t)
  const close = DuckDBConnection.prototype.closeSync
  t.mock.method(DuckDBConnection.prototype, 'closeSync', function () {
    close.call(this)
    throw new Error('injected close failure')
  })
  await assert.rejects(runQuery('SELECT 1'), /DuckDB Execution Error.*injected close failure/)
  assert.deepEqual(events, ['result', 'connection', 'database'])
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
  assert.equal(JSON.parse(res2)[2].running_total, '6')

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

test('db: JSON preserves large integers, decimals and nested values', async () => {
  const rows = JSON.parse(await runQuery(`SELECT
    9007199254740993::BIGINT AS n,
    12345678901234567890.1234::DECIMAL(24,4) AS d,
    [9007199254740993::BIGINT] AS nested`))
  assert.equal(rows[0].n, '9007199254740993')
  assert.equal(rows[0].d, '12345678901234567890.1234')
  assert.deepEqual(rows[0].nested, ['9007199254740993'])
})

test('db: reads a large CSV with bounded JS rows and closes a partial stream', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'db-large-test-'))
  try {
    const csvFile = join(temp, 'large.csv')
    const sqlPath = csvFile.replace(/'/g, "''")
    await runQuery(`COPY (SELECT i AS id, repeat('x', 100) AS payload FROM range(250000) t(i)) TO '${sqlPath}' (HEADER, DELIMITER ',')`)
    assert.ok((await stat(csvFile)).size > 25_000_000)

    const reads = []
    const readUntil = DuckDBResultReader.prototype.readUntil
    t.mock.method(DuckDBResultReader.prototype, 'readUntil', async function (target) {
      await readUntil.call(this, target)
      reads.push({ target, rows: this.currentRowCount })
    })
    const out = await runQuery(`SELECT * FROM read_csv_auto('${sqlPath}')`, 7)
    assert.equal(JSON.parse(out.split('\n[Showing')[0]).length, 7)
    assert.match(out, /additional rows omitted/)
    assert.ok(reads[0].rows < 250000, 'must not materialize the entire CSV in JS')
    assert.equal(reads[0].target, 8)

    const inspection = await createTools().find((tool) => tool.name === 'db_load_file').execute({ path: csvFile })
    assert.match(inspection, /column_name/)
    assert.ok(inspection.length < 10000)
    const total = JSON.parse(await runQuery(`SELECT count(*) AS n, sum(id) AS total FROM read_csv_auto('${sqlPath}')`))[0]
    assert.equal(total.n, '250000')
    assert.equal(total.total, '31249875000')
    t.diagnostic(JSON.stringify({ bytes: (await stat(csvFile)).size, reads }))
    // Also exercises native destruction with an unread streaming result on Windows.
    await unlink(csvFile)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('db: validates row limits and keeps calls isolated', async () => {
  for (const limit of [0, -1, NaN, Infinity, 1.5, 10001]) {
    await assert.rejects(runQuery('SELECT 1', limit), /maxRows must be/)
  }
  await runQuery('CREATE TABLE isolated (id INTEGER)')
  await assert.rejects(runQuery('SELECT * FROM isolated'), /DuckDB Execution Error/)
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
