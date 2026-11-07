# @lvy-jsd/dsh-tool-ultra-pack-db

Database and analytical data queries for [Tool Ultra](https://github.com/lvy-jsd/dsh-tool-ultra).

Uses an embedded [DuckDB](https://duckdb.org/) engine for in-memory OLAP data analysis, aggregations, window functions, and zero-copy queries against local CSV, Parquet, and JSON data files directly via SQL.

## Query lifetime

Each `db_query` call runs in a fresh in-memory database. Tables, transactions and
session settings do not persist across calls; use a single SQL call or query local
files directly. `db_load_file` also releases its inspection databases before it
returns. Both connection and database close callbacks are awaited on success and
failure, so callers can immediately replace or delete a dataset after a tool
finishes, including on Windows. Cleanup errors are reported rather than ignored.

## Tools

| Tool | Group / category | What it does |
| --- | --- | --- |
| `db_query` | data / system | Execute SQL queries in-memory using DuckDB. Supports direct querying of Parquet/CSV files (e.g. `SELECT * FROM 'data.parquet' WHERE ...`). |
| `db_load_file` | data / system | Describe and inspect local CSV, Parquet, or JSON datasets: returns schema metadata and the first 5 sample rows without dumping large datasets into the context window. |
