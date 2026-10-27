# Security

Read-only mode is the default. Keep `MYSQL_ALLOW_WRITE=false` and use a dedicated database account with only the necessary `SELECT` / metadata privileges. SQL validation and MySQL read-only transactions supplement account privileges; they do not replace them.

The server is a local stdio MCP server. Anyone able to invoke its tools receives the configured database account's permitted access. `MYSQL_DATABASE` selects a default schema; it is not an access allowlist. Do not expose the process through an unauthenticated transport wrapper.

Database values, schema names, and comments are untrusted input. Clients must treat resource and tool text as data, not instructions. Markdown tables escape structural characters; JSON output is preferred for machine processing.

SQL policy blocks DDL, administrative statements, executable comments, file operations, session-variable assignments, locking reads and selected side-effecting functions. It is lexical validation, not a complete SQL grammar or a stored-routine sandbox. Views, stored functions, UDFs, and nontransactional engines require appropriate database-side restrictions. Grant no `FILE`, `EXECUTE`, administrative, or write privileges to a read-only account unless explicitly needed and reviewed.

Timeouts and cancellation destroy the connection; they do not guarantee immediate server-side cancellation or rollback of a committed/nontransactional write. Verify outcomes before retrying. Complete transactions must be contained in one call. SQL is never retried automatically.

Use TLS with certificate verification for remote connections and protect environment files. Query logs include validation status, operation type, length, and a hash fingerprint, without SQL values. Driver SQL and raw driver errors are not logged. Limit access to logs as well as client credentials and query results.

Report suspected vulnerabilities privately through the repository's [GitHub security advisory page](https://github.com/hechtcarmel/mysql-mcp-server/security/advisories/new), where available. Do not put credentials, production data, or working exploitation details into a public issue. No separate long-term support policy is promised for older package versions; use the latest maintained release and review its upgrade notes.
