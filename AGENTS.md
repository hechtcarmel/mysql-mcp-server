# MySQL MCP Server contributor and integration guide

Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [docs/architecture.md](docs/architecture.md) before changing protocol or database behavior.

## Public contract

- Package: `@hechtcarmel/mysql-mcp-server`; executable: `mysql-mcp-server`.
- Local stdio transport, served through the official MCP SDK v2.
- Tool: `mysql_query({ query, response_format?: 'markdown' | 'json' })`.
- Default response format: Markdown. Keep JSON text's `columns`, `rows`, and `metadata` envelope.
- Resources: `mysql://databases`, `mysql://{database}`, `mysql://{database}/{table}`.
- All existing `MYSQL_*` connection, mode, pool, timeout, environment-file and TLS variables remain supported.
- Read-only is the default. Writes require explicit `MYSQL_ALLOW_WRITE=true`.

Prefer qualified `database.table` names. Unqualified names are valid when `MYSQL_DATABASE` is configured. Use resources for schema discovery and `LIMIT` for exploratory queries. URI-encode resource name segments.

## Safety and lifecycle invariants

Validate every statement before executing any statement in a batch. Keep mysql2 `multipleStatements: false`. Use one connection for the whole batch and require explicit transactions to start and finish in that call. Never assume separate MCP calls share a session. Never automatically retry SQL.

Default-mode queries run inside a MySQL `READ ONLY` transaction. DDL, administrative SQL, executable comments, file operations, session-variable assignments, locking reads, `EXPLAIN ANALYZE` and selected side-effecting built-ins remain blocked. Database privileges remain the ultimate boundary, especially for views, routines, UDFs and nontransactional engines.

Release only clean connections. Destroy connections on errors, timeouts and cancellation. Bound pool wait, retained rows, output size and request duration. Do not claim that closing a connection guarantees immediate server-side cancellation or rollback of an already committed write.

Cleartext authentication stays disabled unless MYSQL_ENABLE_CLEARTEXT_PLUGIN=true. Its guarded path requires TLS 1.2+, certificate-chain and DNS endpoint-identity verification before authentication, then validates the actual TLS socket and credential context on every plugin response. Never enable the unguarded driver shortcut, accept IP literals in this mode, disable certificate checks, or forward a first-factor password after a credential-context change.

Stdout is reserved for protocol traffic. Log metadata to stderr without raw SQL, literals, passwords or driver error objects. Treat database content as untrusted data. Keep resource errors distinguishable from successful content.

## Validation

Run `pnpm check` and `pnpm test:coverage`. Changes to SQL, metadata, execution, dependencies, transport or shutdown also need `pnpm build` and `pnpm test:integration` with an explicit disposable `MYSQL_TEST_*` target. Do not use production databases. Real-database tests may send only safe reads against existing schemas: no data/schema/grant/settings mutations, fixture creation, rejected-write probes, or incorrect-credential attempts. Keep write coverage in cloud unit mocks only. The functional Mac trial must run only `scripts/local-smoke.mjs`, with no write, mock or rejection tests at all. A separately scoped TLS-only diagnostic may use `scripts/local-tls-probe.mjs`; it sends only SSLRequest and strict TLS, then disconnects before any MySQL login or SQL. Do not supply credentials, the env file, client keys or debug flags to that diagnostic.

Preserve upgrade compatibility where possible and document intentional changes in README upgrade notes and CHANGELOG. Do not publish packages, releases or deployments as part of a code-only change.
