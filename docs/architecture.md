# Architecture and compatibility decisions

The package remains a local stdio server. `src/index.ts` owns configuration, the pool, startup connectivity testing and shutdown. `createServer` composes protocol handlers without opening a database connection or registering process handlers, so tests can exercise MCP contracts independently.

## Protocol

The official `@modelcontextprotocol/server` v2 package supplies schemas, registration, validation and transport behavior. `serveStdio` selects the protocol era from the opening exchange: July 2026 clients use per-request semantics; existing clients retain their initialize handshake. Both paths use the same server factory. We do not manually advertise experimental capabilities or add an HTTP/authentication surface.

The query tool advertises a schema, output schema and annotations based on the configured mode. Existing text responses remain present, with structured content added for newer clients. Tool failures set `isError`; resource failures use protocol errors. Resource templates are discoverable, and the existing dynamic database list is paginated. The server version comes from the installed package manifest.

## SQL policy and execution

Lexical scanning handles quoted strings, escaped/doubled quotes, backtick identifiers, MySQL line/block comments, parenthesis depth and statement delimiters. Executable comments are rejected. For a CTE, the outer operation determines read/write permission. The policy is an explicit allowlist; unknown operations fail closed. MySQL remains the SQL grammar authority, preserving supported MySQL syntax without relying on a third-party parser's incomplete dialect.

The entire batch is validated before connection acquisition, so a disallowed later statement cannot follow an already-executed write. mysql2's multi-statement flag stays off. Statements run individually on one connection. Read-only calls start a database-enforced read-only transaction, including when the account could otherwise write. All successful calls finish with a rollback to clear any outstanding transactional state before reuse. Explicit write transactions must be balanced in one call; savepoints cannot leak between calls.

Calls outside an explicit write transaction retain ordinary MySQL autocommit semantics. Nontransactional tables retain their engine-specific behavior. SQL safety does not inspect view definitions, stored routines or UDFs: least-privilege grants remain essential.

## Resource use and cleanup

One deadline covers pool wait, execution and cleanup for each client operation. The pool has a finite wait queue. A timed-out or cancelled acquisition destroys a connection if it arrives late; a running operation destroys its connection on failure or cancellation. Shutdown destroys active connections and closes the pool idempotently. A narrow driver adapter also destroys the underlying TCP/TLS stream: mysql2 3.x otherwise only half-closes it, which can leave a cancelled long query keeping the process alive. Stdin EOF, signals, startup failure and normal transport closure use the same cleanup path.

Query result events avoid buffering the complete result set in mysql2. The client retains rows up to shared row/character budgets and drains surplus rows. The deadline bounds how long it drains. This bounds retained application data, not query planning/work on the database or a single MySQL protocol packet. Closing a connection is not a server-side `KILL QUERY` guarantee, and cancellation has an uncertain outcome for writes.

Result arrays preserve duplicate column names. mysql2 retains exact large integers as strings and safe integers as numbers. DECIMAL values remain strings, matching mysql2's default. JSON truncation operates on complete rows/metadata and preserves a valid object. Markdown escapes table delimiters, newlines and HTML in table cells.

## Metadata

Metadata queries use prepared parameters for every schema/table filter, including the system-schema exclusion list. Database table counts are aggregated in one query instead of an N+1 loop. Index and foreign-key rows are grouped in ordinal order; foreign-key rules join on schema, table and constraint name. URI segments are decoded once with case preserved. A nonexistent or inaccessible resource is distinct from a database outage.

## Compatibility limits

The package name, command, tool name/arguments, environment variable names, resource patterns, default Markdown, legacy JSON envelope and opt-in writes remain. Node.js 18 cannot run the current official SDK; Node.js 20.19+ is required. Invalid configuration now fails rather than being silently coerced. Unsafe SELECT forms and transactions spread across calls are intentionally rejected. Result limits, machine-readable error signaling and sensitive-log removal are documented changes.

No HTTP endpoint, remote deployment, package publication, live production migration, database schema change, or account provisioning is part of this modernization. The final real-database suites issue only safe reads against existing system schemas. All write/rejection coverage is isolated in cloud unit mocks, and the Mac trial uses a separate fixed read-only helper.
