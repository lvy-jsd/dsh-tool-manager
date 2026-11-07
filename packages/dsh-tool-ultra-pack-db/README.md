# @lvy-jsd/dsh-tool-ultra-pack-db

Database and analytical data queries for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra).

Uses the official `@duckdb/node-api` binding for embedded SQL analytics over local
CSV, Parquet and JSON files. Files are scanned by DuckDB, not read into a full
JavaScript array. This is not a claim of zero-copy execution.

## Query lifetime

Each `db_query` call runs in a fresh in-memory database. Tables, transactions and
session settings do not persist across calls; use a single SQL call or query local
files directly. `db_load_file` also releases its inspection databases before it
returns. Results, connections and instances are explicitly released with the
binding's `closeSync()` APIs in nested `finally` blocks, also on read/SQL failures.
Cleanup errors are reported rather than ignored. Immediate dataset deletion after
success and failure is covered by the Windows CI regression test.

## Large datasets and JSON values

`maxRows` defaults to 500 (allowed range 1–10000). Queries stream into a bounded
prefix: at most the requested row count plus lookahead and one native chunk is
retained as JS rows, rather than fetching the entire result before truncating.
The response reports when additional rows are omitted; it does not invent a total
count. SQL sorts, joins and aggregations can still consume native memory or scan
the complete dataset; the row cap is not a SQL execution or byte-memory quota.
`db_load_file` returns schema plus five sample rows without copying the whole file
into JS. Tests generate a >25 MB / 250,000-row CSV and check prefix reading,
inspection, exact aggregate results and immediate deletion.

The official JSON converter preserves BIGINT/HUGEINT and DECIMAL as strings,
including nested values, rather than rounding them through JavaScript numbers.

## Tools

| Tool | Group / category | What it does |
| --- | --- | --- |
| `db_query` | data / system | Execute SQL queries in-memory using DuckDB. Supports direct querying of Parquet/CSV files (e.g. `SELECT * FROM 'data.parquet' WHERE ...`). |
| `db_load_file` | data / system | Describe and inspect local CSV, Parquet, or JSON datasets: returns schema metadata and the first 5 sample rows without dumping large datasets into the context window. |
