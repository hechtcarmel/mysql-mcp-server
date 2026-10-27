# MySQL MCP Server

[![CI](https://github.com/hechtcarmel/mysql-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/hechtcarmel/mysql-mcp-server/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@hechtcarmel/mysql-mcp-server)](https://www.npmjs.com/package/@hechtcarmel/mysql-mcp-server)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Give MCP clients access to MySQL queries and schema metadata. **Read-only by default**, with writes available only through `MYSQL_ALLOW_WRITE=true`.

- Official MCP TypeScript SDK v2, serving the **2026-07-28** protocol and legacy clients over stdio.
- One `mysql_query` tool, with Markdown, JSON text, and structured results.
- Schema resources for databases, tables, columns, indexes, and foreign keys.
- Database-enforced read-only transactions, validated SQL batches, bounded results, and request cancellation.
- MySQL 8.0 / 8.4 and MariaDB 11.4 integration coverage in CI.

## Quick start

Requires **Node.js 20.19+**; Node.js 24 LTS is recommended. You also need access to a MySQL-compatible server. The MCP server uses stdio and does not open an HTTP port.

Add this entry to a client that accepts `mcpServers` configuration, such as Claude Desktop or Cursor:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@hechtcarmel/mysql-mcp-server"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "mcp_reader",
        "MYSQL_PASSWORD": "replace-with-your-password"
      }
    }
  }
}
```

For clients with a different configuration format, use the same command, arguments, and environment variables. Restart the client after changing its configuration.

Alternatively, put the variables in a protected environment file and set `MYSQL_ENV_FILE` to its absolute path:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@hechtcarmel/mysql-mcp-server"],
      "env": { "MYSQL_ENV_FILE": "/absolute/path/to/mysql.env" }
    }
  }
}
```

See [.env.example](.env.example) for a complete template. Existing environment variables take precedence over file values. Without `MYSQL_ENV_FILE`, the server optionally reads `.env` from its working directory. Neither method encrypts credentials; protect the file and keep it out of version control.

You can also install globally with `npm install -g @hechtcarmel/mysql-mcp-server` and use `mysql-mcp-server` as the command, or run a source build with `node /absolute/path/to/mysql-mcp-server/dist/index.js`.

## Upgrading existing installations

The package name, executable, stdio transport, `mysql_query` arguments, default Markdown response, JSON envelope, environment variable names, and resource URI patterns remain available. Existing client configuration continues to work on a supported Node.js runtime.

Review these changes when upgrading:

- **Node.js 18 is no longer supported.** The current MCP SDK requires Node.js 20+. This project requires 20.19+ for its supported toolchain.
- Invalid numeric values such as `3306abc`, and boolean values other than `true` / `false`, now fail startup instead of being silently interpreted. Error messages identify the variable without printing its value.
- Read-only queries run inside a MySQL `READ ONLY` transaction. File access, executable SQL comments, session-variable assignments, side-effecting built-ins, locking reads, and `EXPLAIN ANALYZE` are rejected in both modes.
- Transactions must start and finish **in one tool call**. The old implementation returned pooled connections between calls, so separate `BEGIN` and `COMMIT` calls could not reliably share a transaction.
- Results retain at most 1,000 rows per call by default. Set `MYSQL_MAX_ROWS` to change that limit. JSON remains valid when truncated; `metadata.truncated` reports truncation and `rowCount` counts returned rows.
- Tool failures set `isError: true`. Resource failures use MCP protocol errors instead of successful responses containing error text.
- Query logs contain fingerprints and validation metadata, rather than SQL text. Driver SQL, query values, and passwords are excluded from logs.

The changes are described in [CHANGELOG.md](CHANGELOG.md), with design details in [docs/architecture.md](docs/architecture.md).

## Configuration

| Variable                           | Default         | Meaning                                                           |
| ---------------------------------- | --------------- | ----------------------------------------------------------------- |
| `MYSQL_HOST`                       | Required        | Database hostname                                                 |
| `MYSQL_USER`                       | Required        | MySQL account                                                     |
| `MYSQL_PASSWORD`                   | Required        | Nonempty account password                                         |
| `MYSQL_PORT`                       | `3306`          | Port, 1–65535                                                     |
| `MYSQL_DATABASE`                   | Unset           | Default database for unqualified table names                      |
| `MYSQL_ALLOW_WRITE`                | `false`         | Enable DML and complete transactions                              |
| `MYSQL_POOL_SIZE`                  | `10`            | Maximum connections, 1–1000                                       |
| `MYSQL_CONNECTION_TIMEOUT`         | `10000`         | Connection timeout in milliseconds, 1000–60000                    |
| `MYSQL_QUERY_TIMEOUT`              | `30000`         | Per-call deadline including pool wait and cleanup, 1000–600000 ms |
| `MYSQL_MAX_ROWS`                   | `1000`          | Retained rows per call, 1–100000                                  |
| `MYSQL_ENV_FILE`                   | Optional `.env` | Explicit file path; a missing explicit file fails startup         |
| `MYSQL_SSL`                        | `false`         | Enable TLS with system certificate authorities                    |
| `MYSQL_SSL_CA`                     | Unset           | CA file path; also enables TLS                                    |
| `MYSQL_SSL_CERT` / `MYSQL_SSL_KEY` | Unset           | Client certificate and key paths; configure together              |
| `MYSQL_SSL_REJECT_UNAUTHORIZED`    | `true`          | Verify the server certificate                                     |

Booleans accept `true` and `false`, case-insensitively. Configure TLS for remote database connections. An account with only the required grants remains the primary security boundary; the server does not restrict access to a configured database if that account can access others.

## Query tool

`mysql_query` accepts the same input as before:

```json
{
  "query": "SELECT id, name FROM shop.products ORDER BY id LIMIT 10",
  "response_format": "json"
}
```

`query` is required and limited to 10,000 characters. `response_format` is optional: `markdown` (default) or `json`. Prefer fully qualified `database.table` names; unqualified names work when `MYSQL_DATABASE` is set.

Successful responses include text in the selected format and matching `structuredContent`:

```json
{
  "columns": [{ "name": "id", "type": "LONG" }],
  "rows": [[1]],
  "metadata": {
    "rowCount": 1,
    "executionTime": 4,
    "truncated": false
  }
}
```

DML metadata additionally includes `affectedRows`, `insertId`, and `changedRows`. Duplicate column names retain their separate values by position. Safe integers remain numbers; integers beyond JavaScript's exact range and DECIMAL values are strings. Dates serialize as ISO strings, binary values as base64, and SQL `NULL` as JSON `null`.

Both text and structured results have a 25,000-character budget. Truncation removes complete rows, with `metadata.truncated: true`; unusually large column metadata may also be reduced. Use narrower columns, filters, and `LIMIT` to retrieve omitted data. The row limit bounds retained application data; it does not add a SQL `LIMIT` or bound database work. Extra rows are drained and discarded until the request deadline.

### SQL policy

| Operation                                                                                                                               | Default mode                      | Write mode                                        |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| `SELECT`, `SHOW`, `DESCRIBE` / `DESC`, `EXPLAIN`                                                                                        | Allowed, subject to safety checks | Allowed, subject to safety checks                 |
| `INSERT`, `UPDATE`, `DELETE`, `REPLACE`                                                                                                 | Blocked                           | Allowed                                           |
| `BEGIN` / `START TRANSACTION`, savepoints, `COMMIT`, `ROLLBACK`                                                                         | Blocked                           | Allowed within a complete transaction in one call |
| DDL (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`)                                                                                             | Blocked                           | Blocked                                           |
| Administrative commands, `CALL`, `SET`, `USE`, `LOAD DATA`                                                                              | Blocked                           | Blocked                                           |
| File operations, executable comments, session-variable assignments, locking reads, `EXPLAIN ANALYZE`, selected side-effecting built-ins | Blocked                           | Blocked                                           |

The validator scans MySQL strings, identifiers, comments, CTEs, and statement boundaries. MySQL itself validates full SQL syntax. This is a defense layer, not a sandbox for arbitrary stored functions or UDFs. Use least-privilege grants, especially when write mode is enabled. Views and database routines can perform work that lexical validation cannot see.

### Batches and transactions

Up to 50 statements can run in one call. Every statement is validated before any execution. Statements run sequentially on one connection; response `results` contains their outputs in order, alongside the first result's legacy fields.

```sql
START TRANSACTION;
UPDATE shop.accounts SET balance = balance - 10 WHERE id = 1;
UPDATE shop.accounts SET balance = balance + 10 WHERE id = 2;
COMMIT;
```

An execution failure destroys the connection, rolling back its open InnoDB transaction. Successful writes outside an explicit transaction commit normally, so a later statement failure does not undo those earlier writes. Nontransactional tables do not gain rollback guarantees.

Timeout or cancellation closes the connection but cannot prove that a write did not commit, or that MySQL stopped all server-side work immediately. **Verify write outcomes before retrying.** The server never automatically retries SQL.

## Schema resources

| URI                          | Contents                                                                  |
| ---------------------------- | ------------------------------------------------------------------------- |
| `mysql://databases`          | Accessible non-system databases, character sets, collations, table counts |
| `mysql://{database}`         | Database information and table/view metadata                              |
| `mysql://{database}/{table}` | Columns, indexes, foreign keys and table statistics                       |

Resources return Markdown. URI-encode each name segment when necessary; identifier case is preserved. Resource discovery includes the database list and database resources, with 100 entries per page. Both parameterized patterns appear in `resources/templates/list`.

Schema filters use prepared parameters. System schemas are omitted from discovery but may be queried when the database account has permission. `mysql://databases` is reserved for the database list. InnoDB row statistics are estimates.

## Passwords and the real Mac trial

Special characters are passed literally to mysql2. Quote dotenv values containing `#`, whitespace, or other special characters, and avoid putting passwords in shell commands or connection URLs. See [password handling](docs/password-handling.md) for exact quoting rules and the limits of what has been reproduced.

Before merge, use the [isolated Mac validation](docs/local-validation.md) with the existing local env file. It forces read-only mode and runs only `SELECT 1` plus MCP metadata checks. Do not run write, rejection, mock, or aggregate suites against that real local setup. No connection file should be copied to the cloud or modified.

## Development and tests

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test:coverage
```

For integration tests, start a **disposable** database and explicitly provide separate test variables. Tests send only safe reads against existing system schemas and create no database fixtures. Never point cloud tests at a production server.

```sh
docker run --rm -d --name mysql-mcp-test \
  -p 127.0.0.1:3307:3306 -e MYSQL_ROOT_PASSWORD=mcp-test-password mysql:8.4
# Wait until the database is ready.
pnpm build
MYSQL_TEST_HOST=127.0.0.1 MYSQL_TEST_PORT=3307 \
MYSQL_TEST_USER=root MYSQL_TEST_PASSWORD=mcp-test-password pnpm test:integration
docker stop mysql-mcp-test
```

CI runs quality checks on Node.js 20.19, 22, 24.15.0 (the Mac trial runtime), and the current 24 release; separate integration jobs exercise MySQL 8.0, MySQL 8.4, and MariaDB 11.4. It also builds an npm tarball for review. Release preparation and approved npm OIDC publication are documented in [docs/releases.md](docs/releases.md); neither is run by ordinary CI.

`pnpm test:package` uses the same explicit `MYSQL_TEST_*` variables to build a tarball, install only its runtime dependencies in a temporary directory, inspect its contents, and run the CLI integration suite against the installed package. It requires npm registry access and cleans up afterward.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project structure and verification workflow, and [SECURITY.md](SECURITY.md) for security boundaries and reporting.

## Troubleshooting

- **Startup fails:** check Node.js, required variables, the explicit environment file, TLS file permissions, and MySQL grants. Diagnostic logs go to stderr; stdout is reserved for MCP messages. `mysql-startup` events identify the configuration, pool, database connection, and MCP transport phases with fixed error categories; they do not include connection values or raw driver errors.
- **Unqualified table fails:** set `MYSQL_DATABASE` or use `database.table`.
- **Query blocked:** check the SQL policy and operation mode. Enable writes only in the server's environment, then restart the client.
- **Timeout:** narrow the query, inspect its plan, or adjust `MYSQL_QUERY_TIMEOUT`. Check a write's outcome before retrying.
- **Resource error:** verify the encoded URI and database privileges. Missing resources and database outages are distinguishable protocol failures.

## License

[MIT](LICENSE). Built with the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [mysql2](https://github.com/sidorares/node-mysql2).
