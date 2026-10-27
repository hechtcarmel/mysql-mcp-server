# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Migrated to the current official MCP SDK v2 and Zod v4. The stdio entry point serves the 2026-07-28 protocol and legacy initialize-based clients from one implementation.
- Retained the package, executable, tool name/arguments, default Markdown, JSON envelope, environment variable names and schema resource URI patterns. Requires Node.js 20.19+; Node.js 18 users must upgrade their runtime.
- Separated CLI lifecycle from testable server composition, using the installed package version in server metadata. Added tool annotations, output schemas, structured content, resource templates and paginated database discovery.
- Replaced regex-only SQL handling with lexical scanning of quotes, identifiers, comments, CTE operations and statement boundaries. Validate whole batches before executing, with a maximum of 50 statements and unchanged 10,000-character query limit.
- Enforced default read-only behavior with MySQL READ ONLY transactions. Block executable comments, file access, session-variable assignments, locking reads, EXPLAIN ANALYZE and selected side-effecting built-ins in both modes.
- Run batches on one connection. Require transactions to finish in the same call; clean up failed sessions and preserve ordinary autocommit behavior outside explicit transactions.
- Added pool-wait/execution deadlines, cancellation handling, bounded queues, streaming result retention, a configurable MYSQL_MAX_ROWS limit (default 1,000), and cleanup on EOF, signals and startup failure.
- Preserved valid JSON under truncation, escaped Markdown table cells, kept duplicate column values by position and retained exact BIGINT/DECIMAL values. Structured results share the legacy text response's 25,000-character budget.
- Mark tool errors with isError and report resource failures through protocol errors. Query logs now contain validation metadata/fingerprints instead of SQL text; raw driver errors and SQL values are excluded.
- Validate configuration strictly without echoing values. Retain environment-file precedence and certificate settings; add MYSQL_SSL for TLS using system trust and require paired client certificate/key files.

### Fixed

- Bind all metadata query parameters. The previous client executed SQL containing unbound placeholders.
- Retrieve database table counts in one aggregated query, preserve identifier case, handle encoded resource names and join foreign-key metadata using schema/table/constraint identity.
- Remove hardcoded server version, misleading pool statistics, swallowed resource errors, package-manager-specific install hooks and documentation links to missing files.

### Local validation and release controls

- Capture one observed smoke process with explicit exit/signal evidence and secret-safe configuration/startup/transport/protocol/database categories. Pin the expected modern protocol so an invisible disposable probe cannot discard startup diagnostics. The earlier Mac connection failure remains unclassified until a corrected local retry.
- Add isolated real-SDK process regressions and a CI runtime matching the Mac's Node.js 24.15.0. Real local checks remain limited to SELECT 1 and MCP metadata.

- Added safe incremental smoke-stage diagnostics with explicit failures and normal macOS symlink handling; raw errors, credentials and query results are never echoed by the Mac helper.
- Reviewed tool discovery against the official SDK guidance: mode/config-aware descriptions, bounded input examples, concrete batch output schemas and conservative annotations. CI artifacts include a tarball checksum for portable verification.

- Added a separate reversible Mac preview and fixed read-only smoke helper using the existing env file, with write mode forcibly disabled and no write/rejection/mock checks in the local trial.
- Added dummy-password regression coverage for special characters and documented dotenv quoting, shell expansion, JSON configuration and environment precedence without URL encoding or credential changes.
- Prepared exact-tag CI, version/changelog validation, draft GitHub releases with checksummed tarballs, and protected npm trusted publishing with provenance. No release, npm publication, security-setting change or merge is performed by this code change.

### Development

- Added isolated configuration, SQL safety, formatting, pool lifecycle and in-memory MCP contract tests.
- Added read-only database integration tests covering existing system-schema metadata, exact values, current/legacy protocol clients, environment files, built CLI operation and shutdown. Write/rejection coverage uses isolated cloud unit mocks only.
- Added SHA-pinned GitHub Actions quality checks on Node.js 20.19/22/24, database jobs for MySQL 8.0/8.4 and MariaDB 11.4, and a reviewable npm package artifact. Added validated draft releases and protected npm OIDC publication from reviewed release assets.
- Added strict source/test type checks, ESLint flat configuration, formatting, coverage tooling, dependency maintenance, package allowlisting, contributor/security documentation and an architecture guide.

## [1.0.0] - 2025-01-12

### Added

#### Core Features

- **Secure Query Execution**: Unified `mysql_query` tool with intelligent SQL parsing
- **Read-Only Mode**: Default secure mode that blocks all write operations
- **Write Mode**: Optional mode enabling INSERT, UPDATE, DELETE operations when explicitly enabled
- **Query Parser**: Robust SQL parser that detects and blocks dangerous operations
- **Multi-Database Support**: Fully qualified `database.table` naming for accessing multiple databases

#### MCP Resources

- **Database List Resource** (`mysql://databases`): List all accessible databases
- **Database Resource** (`mysql://{database}`): Get database info and table list
- **Table Resource** (`mysql://{database}/{table}`): Complete table schema with columns, indexes, and foreign keys
- **Dynamic Resource Discovery**: Automatic enumeration of available databases

#### Response Formats

- **Markdown Format**: Human-readable formatted output with tables (default)
- **JSON Format**: Structured data for programmatic processing
- **Automatic Truncation**: Responses truncated at 25,000 characters with helpful suggestions

#### Connection Management

- **Connection Pooling**: Efficient mysql2 connection pool with configurable limits
- **SSL/TLS Support**: Secure database connections with certificate validation
- **Health Checks**: Automatic connection testing on startup
- **Graceful Shutdown**: Proper cleanup of connections and resources

#### Security Features

- **Query Validation**: Multi-layer security with parse-time validation
- **Dangerous Operation Blocking**: DROP, TRUNCATE, GRANT, REVOKE always blocked
- **Audit Logging**: All queries logged to stderr for audit purposes
- **Query Timeouts**: Configurable timeouts prevent resource exhaustion
- **SSL Certificate Validation**: Configurable certificate validation for secure connections

#### Configuration

- **Environment Variable Configuration**: Flexible configuration via .env files
- **Configurable Timeouts**: Connection and query timeouts
- **Pool Size Configuration**: Adjustable connection pool size
- **Custom .env File Support**: Specify alternate .env file location

#### Error Handling

- **Comprehensive Error Messages**: Clear, actionable error messages for all scenarios
- **Context-Aware Suggestions**: Helpful suggestions for resolving common errors
- **MySQL Error Translation**: User-friendly translations of MySQL error codes
- **Timeout Guidance**: Specific suggestions for query optimization on timeout

#### Developer Experience

- **TypeScript**: Full TypeScript implementation with strict mode
- **Type Safety**: Comprehensive type definitions throughout
- **Zod Validation**: Input validation with detailed error messages
- **Modular Architecture**: Clean separation of concerns
- **Well-Documented Code**: Extensive inline documentation

### Technical Details

#### Dependencies

- `@modelcontextprotocol/sdk` ^1.0.4 - MCP SDK for server implementation
- `mysql2` ^3.11.5 - MySQL client with promise support
- `zod` ^3.23.8 - Schema validation

#### Query Types Supported

- **Always Allowed**: SELECT, SHOW, DESCRIBE, EXPLAIN
- **Write Mode Only**: INSERT, UPDATE, DELETE, REPLACE, Transactions
- **Always Blocked**: DROP, TRUNCATE, GRANT, REVOKE, FLUSH, KILL, LOAD DATA

#### Response Limits

- Maximum query length: 10,000 characters
- Maximum response size: 25,000 characters (with truncation)
- Default query timeout: 30 seconds
- Default connection timeout: 10 seconds
- Default pool size: 10 connections

### Documentation

- Comprehensive README with installation, configuration, and usage instructions
- Detailed security considerations and best practices
- Troubleshooting guide for common issues
- Example configurations for Claude Desktop
- Complete API documentation for all tools and resources

### Testing

- Successful TypeScript compilation with strict mode
- Connection pool initialization and testing
- Environment variable validation
- Build verification with `npm run build`

---

## Release Notes

### Version 1.0.0 - Initial Release

This is the first production-ready release of the MySQL MCP Server. The server provides a secure, flexible way for LLMs to interact with MySQL databases through the Model Context Protocol.

**Key Highlights:**

- 🔒 Secure by default with read-only mode
- 🔍 Efficient schema discovery via MCP resources
- 💪 Full SQL expressiveness with intelligent safety parsing
- 📊 Multiple response formats (JSON and Markdown)
- ⚡ Production-ready with connection pooling and SSL support

**Getting Started:**

1. Install with `npm install`
2. Configure your MySQL connection in `.env`
3. Build with `npm run build`
4. Add to your MCP client configuration
5. Start querying your databases safely!

**Security Note:**
Always start with read-only mode and only enable write mode when necessary. Use MySQL user permissions as your ultimate security boundary.

---

For more information, see the [README.md](README.md) file.
