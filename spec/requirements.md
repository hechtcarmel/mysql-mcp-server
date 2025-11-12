# MySQL MCP Server - Requirements Document

## Project Overview

A Model Context Protocol (MCP) server that provides LLMs with flexible, safe access to MySQL databases. The server enables AI agents to explore database schemas via MCP resources, execute raw SQL queries with intelligent safety parsing, and optionally perform write operations when explicitly enabled. The server uses query parsing to enforce read-only mode by default, blocking dangerous operations while allowing full SQL expressiveness.

## Core Requirements

### 1. Query-Based Operation Modes

**REQ-1.1**: The server MUST default to read-only mode to prevent accidental data modification.

**REQ-1.2**: The server MUST support an optional write mode that can be explicitly enabled via environment variable (`MYSQL_ALLOW_WRITE=true`).

**REQ-1.3**: Operation mode MUST be enforced through intelligent SQL query parsing that detects query intent:

**Read-Only Mode (Default)**:
- ALLOW: SELECT, SHOW, DESCRIBE, EXPLAIN queries
- BLOCK: INSERT, UPDATE, DELETE, REPLACE
- BLOCK: DDL operations (CREATE, ALTER, DROP, TRUNCATE)
- BLOCK: Transaction control (START TRANSACTION, COMMIT, ROLLBACK, SAVEPOINT)
- BLOCK: Administrative commands (GRANT, REVOKE, FLUSH, KILL, LOAD DATA)
- BLOCK: Database/user management (CREATE/DROP DATABASE, CREATE/DROP USER)

**Write Mode (When Enabled)**:
- ALLOW: All read operations
- ALLOW: Data manipulation (INSERT, UPDATE, DELETE, REPLACE)
- ALLOW: Transaction control (START TRANSACTION, COMMIT, ROLLBACK, SAVEPOINT)
- BLOCK: Dangerous DDL (DROP DATABASE, DROP TABLE, TRUNCATE)
- BLOCK: Administrative commands (GRANT, REVOKE, FLUSH, KILL, LOAD DATA)
- BLOCK: User management (CREATE/DROP USER, SET PASSWORD)
- CONDITIONAL: Safe DDL may be allowed with additional env var flag (future consideration)

**REQ-1.4**: Query parsing MUST use pattern matching and SQL syntax analysis to detect query types:
- Case-insensitive keyword detection
- Handle multi-statement queries (block if any statement is disallowed)
- Detect query type from leading keywords
- Ignore comments and whitespace

**REQ-1.5**: When a blocked query is detected, the server MUST:
- Return a clear error message indicating why the query was blocked
- Specify which operation was detected
- Indicate current server mode (read-only or write)
- Suggest how to enable write mode if applicable (for DML operations)

### 2. Multi-Database/Schema Support and Fully Qualified Names

**REQ-2.1**: The server MUST support connecting to multiple MySQL databases/schemas simultaneously.

**REQ-2.2**: SQL queries MUST use fully qualified table names in the format `database.table` (e.g., `SELECT * FROM trc.persons`).

**REQ-2.3**: The server MUST maintain a single connection pool that can execute queries against any accessible database without requiring explicit database switching.

**REQ-2.4**: The server SHOULD provide helpful error messages when:
- Queries use unqualified table names (e.g., `SELECT * FROM persons`)
- Referenced databases don't exist or are inaccessible
- Users don't have permissions for specified databases

**REQ-2.5**: Database discovery through MCP resources and metadata tools MUST help LLMs identify available databases and construct properly qualified queries.

**REQ-2.6**: For metadata queries (INFORMATION_SCHEMA), the server MAY use system databases without requiring fully qualified names in internal queries.

### 3. MCP Resources for Schema Discovery

**REQ-3.1**: The server MUST expose databases and tables as MCP resources for efficient, URI-based access to schema metadata.

**REQ-3.2**: Resource URI patterns MUST follow this structure:
- `mysql://databases` - List all accessible databases
- `mysql://{database}` - Get database information and table list
- `mysql://{database}/{table}` - Get complete table schema

**REQ-3.3**: Database resource (`mysql://{database}`) MUST return:
- Database name and character set
- List of all tables in the database
- Table counts and basic statistics
- Database-level privileges (if accessible)

**REQ-3.4**: Table resource (`mysql://{database}/{table}`) MUST return complete table structure including:
- Column names, data types, and ordinal positions
- Nullable status and default values
- Primary key columns
- Indexes (type, columns, uniqueness)
- Foreign key relationships (referenced tables and columns)
- Column character sets and collations
- Table comments and column comments
- Table engine and row format
- Approximate row count and table size

**REQ-3.5**: Resource responses MUST be formatted as:
- JSON for programmatic access (machine-readable)
- Markdown for human-readable display (default, with well-formatted tables)

**REQ-3.6**: Resources MUST be dynamically discovered - the server MUST support `resources/list` to enumerate all accessible databases and tables.

**REQ-3.7**: Resources MUST handle errors gracefully:
- Non-existent databases/tables return clear error messages
- Permission-denied errors indicate which database/table is inaccessible
- Connection errors provide actionable troubleshooting guidance

### 4. Unified Query Execution Tool

**REQ-4.1**: The server MUST provide a single unified tool `mysql_query` that accepts raw SQL queries.

**REQ-4.2**: The `mysql_query` tool MUST accept the following parameters:
- `query` (required, string): The SQL query to execute
- `response_format` (optional, enum): Output format - "markdown" (default) or "json"

**REQ-4.3**: Query execution flow:
1. Parse the query to detect operation type (SELECT, INSERT, UPDATE, etc.)
2. Validate the query against current server mode (read-only vs write)
3. Block disallowed operations with clear error messages
4. Execute allowed queries using the connection pool
5. Format results according to requested response format
6. Apply CHARACTER_LIMIT truncation if necessary
7. Return results or error messages as tool output

**REQ-4.4**: Query validation MUST:
- Strip leading/trailing whitespace and comments
- Detect query type from leading SQL keywords (case-insensitive)
- Handle multi-statement queries (semicolon-separated)
- Block entire query if any statement is disallowed
- Prevent SQL injection through prepared statements where possible

**REQ-4.5**: Query execution MUST support:
- Query timeout configuration (via `MYSQL_QUERY_TIMEOUT`)
- Multiple response formats (JSON, Markdown)
- Automatic result truncation at CHARACTER_LIMIT (25,000 characters)
- Fully qualified table names (database.table format required)

**REQ-4.6**: The tool MUST NOT support:
- Parameterized query placeholders (LLMs write complete queries)
- Query batching (one query per tool call)
- Transaction state persistence across tool calls

**REQ-4.7**: Result formatting:

**JSON Format**:
- Return structured data suitable for programmatic processing
- Include column metadata (names, types)
- Include result statistics (rows affected, execution time)
- Include pagination hints if results are truncated
- Format: `{ "columns": [...], "rows": [...], "rowCount": N, "truncated": boolean }`

**Markdown Format** (default):
- Return human-readable formatted results
- Use markdown tables for SELECT result sets
- Show affected rows count for DML operations
- Include execution time and warnings
- Provide clear truncation messages if applicable

**REQ-4.8**: Error handling MUST provide specific guidance:
- Syntax errors: Show MySQL error message with line/position if available
- Blocked operations: Explain why query was blocked and current server mode
- Unqualified table names: Suggest using database.table format
- Permission errors: Indicate which database/table is inaccessible
- Timeout errors: Suggest query optimization or timeout adjustment
- Connection errors: Provide connection status and retry guidance

### 5. Configuration and Credentials

**REQ-5.1**: Database credentials MUST be provided via environment variables.

**REQ-5.2**: The server MUST support loading credentials from a .env file whose path can be specified via an environment variable (`MYSQL_ENV_FILE`).

**REQ-5.3**: Required configuration parameters:

**Connection Parameters (Required)**:
- `MYSQL_HOST`: Database host address (required)
- `MYSQL_PORT`: Database port (default: 3306)
- `MYSQL_USER`: Database username (required)
- `MYSQL_PASSWORD`: Database password (required)

**Operation Mode**:
- `MYSQL_ALLOW_WRITE`: Enable write operations - "true" or "false" (default: "false")
  - When "false": Only SELECT, SHOW, DESCRIBE, EXPLAIN queries allowed
  - When "true": Also allows INSERT, UPDATE, DELETE, REPLACE, and transactions

**Connection Pool Configuration**:
- `MYSQL_POOL_SIZE`: Maximum connections in pool (default: 10)
- `MYSQL_CONNECTION_TIMEOUT`: Connection timeout in ms (default: 10000)
- `MYSQL_QUERY_TIMEOUT`: Query execution timeout in ms (default: 30000)

**Optional Parameters**:
- `MYSQL_DATABASE`: Default database name (optional, not commonly used with fully qualified names)
- `MYSQL_SSL_CA`: Path to SSL CA certificate (optional)
- `MYSQL_SSL_CERT`: Path to SSL client certificate (optional)
- `MYSQL_SSL_KEY`: Path to SSL client key (optional)
- `MYSQL_SSL_REJECT_UNAUTHORIZED`: Reject unauthorized SSL certificates - "true" or "false" (default: "true")

**REQ-5.4**: The server MUST validate all required environment variables on startup and fail with clear error messages if any are missing.

**REQ-5.5**: The server MUST log the current operation mode on startup (READ-ONLY or WRITE ENABLED) to stderr for visibility.

**REQ-5.6**: Sensitive credentials MUST NEVER be logged or exposed in error messages.

**REQ-5.7**: When `MYSQL_ALLOW_WRITE=true`, the server MUST log a prominent warning about the security implications to stderr.

### 6. TypeScript and Best Practices

**REQ-6.1**: The entire codebase MUST be written in TypeScript with strict mode enabled.

**REQ-6.2**: The server MUST follow MCP best practices as defined in the MCP specification:
- Tool naming: snake_case with `mysql_` prefix (e.g., `mysql_query`)
- Server naming: `mysql-mcp-server`
- Resource naming: URI format `mysql://` scheme (e.g., `mysql://database/table`)
- Proper tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
- Tool annotations MUST reflect actual query safety (not mode-dependent)
- Comprehensive tool descriptions with SQL examples and error handling guidance

**REQ-6.3**: Input validation MUST use Zod schemas with proper constraints and error messages.

**REQ-6.4**: The codebase MUST follow TypeScript best practices:
- No use of `any` type
- Explicit return types for all functions
- Proper error handling with type guards
- Async/await for all I/O operations

**REQ-6.5**: Code MUST be modular and reusable:
- Shared utilities for common operations
- No code duplication between tools
- Extracted helper functions for formatting, pagination, and error handling

### 7. Dependencies and Libraries

**REQ-7.1**: The server MUST use the following core dependencies:
- `@modelcontextprotocol/sdk`: MCP TypeScript SDK for server implementation (required)
- `mysql2`: MySQL client library with promise support (required)
- `zod`: Schema validation and type inference (required)
- `dotenv`: Environment variable management (optional)

**REQ-7.2**: For SQL query parsing and validation, the server MAY use:
- Pattern matching with regex for keyword detection (lightweight option)
- `node-sql-parser`: SQL parser for more robust query analysis (if needed)
- Custom parsing logic for MySQL-specific syntax

**REQ-7.3**: All dependencies MUST be explicitly typed with no reliance on `any` types.

**REQ-7.4**: The project MUST be buildable with `npm run build` and runnable with `node dist/index.js`.

**REQ-7.5**: Development dependencies SHOULD include:
- `@types/node`: TypeScript type definitions for Node.js
- `typescript`: TypeScript compiler
- `tsx`: TypeScript execution for development

### 8. Security Requirements

**REQ-8.1**: SQL injection prevention:
- LLM-provided queries are executed as-is (no parameterization needed)
- Query parsing MUST detect and block malicious patterns
- Multi-statement queries with mixed operations MUST be blocked entirely
- The server relies on MySQL user permissions as the ultimate security boundary
- Queries SHOULD be logged (to stderr) for audit purposes

**REQ-8.2**: Query parsing security:
- Parser MUST be resilient to bypass attempts (comment tricks, Unicode, etc.)
- All SQL keywords MUST be detected case-insensitively
- Leading/trailing whitespace and comments MUST be stripped before analysis
- Multi-line queries MUST be properly analyzed
- Subqueries in SELECT statements MUST be allowed but validated recursively

**REQ-8.3**: Operation mode enforcement:
- Read-only mode MUST be the secure default
- Write mode MUST require explicit environment variable setting
- Dangerous DDL MUST be blocked even in write mode (DROP DATABASE, TRUNCATE, etc.)
- Administrative commands MUST never be allowed (GRANT, REVOKE, etc.)

**REQ-8.4**: Connection security:
- Support SSL/TLS connections to MySQL server
- Validate SSL certificates (configurable via `MYSQL_SSL_REJECT_UNAUTHORIZED`)
- Support custom SSL certificates via `MYSQL_SSL_*` environment variables
- Support SSH tunneling configuration (future enhancement)

**REQ-8.5**: Access control:
- Respect MySQL user permissions as the primary security boundary
- Provide clear error messages for permission-denied scenarios
- Log security-relevant events (without exposing sensitive data)
- Never expose connection credentials in error messages or logs

**REQ-8.6**: Resource protection:
- Implement query timeouts to prevent long-running queries
- Respect connection pool limits to prevent resource exhaustion
- Truncate large result sets with clear messaging
- Implement rate limiting for resource-intensive operations (future enhancement)

### 9. Error Handling

**REQ-9.1**: All errors MUST be caught and returned as MCP tool errors (not protocol-level errors).

**REQ-9.2**: Error messages MUST be:
- Clear and actionable
- Educational (guide users toward correct usage)
- Free of sensitive information (connection strings, credentials)
- Specific about what went wrong and how to fix it

**REQ-9.3**: Common error scenarios MUST be handled explicitly:
- Database connection failures
- Invalid database/table names
- Query syntax errors
- Permission denied
- Query timeout
- Connection pool exhaustion
- Result set too large

### 10. Response Formats

**REQ-10.1**: The `mysql_query` tool and all resources MUST support both JSON and Markdown formats.

**REQ-10.2**: JSON format MUST:
- Include all available data fields
- Use consistent field naming conventions (camelCase for metadata, preserve column names from database)
- Include query metadata (executionTime, rowCount, truncated, etc.)
- Be suitable for programmatic processing
- Format: `{ "columns": [...], "rows": [...], "metadata": {...} }`

**REQ-10.3**: Markdown format MUST:
- Be human-readable with clear formatting
- Use markdown tables for SELECT result sets (with proper alignment)
- Show affected rows count for DML operations clearly
- Include headers and sections for organization
- Omit verbose internal metadata
- Be the default format for query tool and resources
- Include clear truncation warnings when data is cut off

**REQ-10.4**: Result set handling:
- Large result sets MUST be truncated at CHARACTER_LIMIT (25,000 characters)
- Truncation messages MUST clearly indicate:
  - How many rows were included vs total
  - Suggestion to add LIMIT clause to queries
  - Recommendation to use WHERE clauses for filtering
- For resources, truncation should be less common but handled similarly

**REQ-10.5**: Response size MUST be limited to CHARACTER_LIMIT (25,000 characters) with truncation and clear messaging:
- Check response length before returning
- If truncated, include metadata about truncation
- Suggest optimization strategies (LIMIT, WHERE, specific columns)

### 11. Performance Requirements

**REQ-11.1**: Connection pooling MUST be implemented using mysql2 connection pools.

**REQ-11.2**: Pool configuration MUST be optimized for:
- Reusable connections
- Automatic connection recycling
- Proper timeout handling
- Keep-alive for idle connections

**REQ-11.3**: Metadata queries MUST be optimized:
- Use INFORMATION_SCHEMA efficiently
- Cache frequently accessed metadata (future enhancement)
- Avoid full table scans

**REQ-11.4**: Query execution MUST respect timeouts:
- Connection timeout (10s default)
- Query timeout (30s default)
- Both configurable via environment variables

### 12. Documentation Requirements

**REQ-12.1**: Each tool MUST have comprehensive descriptions including:
- One-line summary
- Detailed functionality explanation
- Complete parameter documentation with types and examples
- Return value schema documentation
- Usage examples (when to use, when not to use)
- Error handling documentation

**REQ-12.2**: The README MUST include:
- Installation instructions
- Configuration guide with all environment variables
- Usage examples with Claude Desktop and other MCP clients
- Security considerations
- Troubleshooting guide

**REQ-12.3**: Code MUST be self-documenting:
- Clear variable and function names
- TypeScript interfaces for all data structures
- JSDoc comments for complex logic (when necessary)

### 13. Testing Requirements

**REQ-13.1**: The server MUST be testable with the MCP evaluation framework.

**REQ-13.2**: Build verification:
- `npm run build` must complete successfully
- `dist/index.js` must be created
- Server must start without errors when properly configured

**REQ-13.3**: Functional testing (future requirement):
- Unit tests for utility functions
- Integration tests with real MySQL databases
- Security tests for SQL injection prevention

## Non-Functional Requirements

### Maintainability

**NFR-1**: Code MUST be modular with clear separation of concerns:
- `/src/index.ts` - Server initialization and transport setup
- `/src/tools/` - Tool implementations grouped by domain
- `/src/services/` - MySQL client and shared utilities
- `/src/schemas/` - Zod validation schemas
- `/src/types.ts` - TypeScript type definitions
- `/src/constants.ts` - Configuration constants

**NFR-2**: Common functionality MUST be extracted into reusable utilities to avoid duplication.

### Scalability

**NFR-3**: The server MUST efficiently handle:
- Multiple concurrent tool calls
- Large databases with thousands of tables
- Result sets with millions of rows (via pagination)

### Reliability

**NFR-4**: The server MUST:
- Handle connection failures gracefully with automatic retry logic
- Release connections properly even in error conditions
- Recover from transient database errors
- Provide clear status information about database connectivity

### Usability

**NFR-5**: The server MUST:
- Provide intuitive tool names that reflect natural task subdivisions
- Return information optimized for LLM context efficiency
- Use human-readable identifiers (names over IDs where appropriate)
- Guide users toward successful query patterns through error messages

## Future Enhancements (Out of Scope for V1)

1. **Query History**: Track and log executed queries for audit purposes with timestamps
2. **Query Optimization**: Automatic EXPLAIN plan analysis and performance suggestions
3. **Result Caching**: Cache frequently accessed metadata and query results
4. **Multiple Connection Profiles**: Support connecting to multiple MySQL servers simultaneously
5. **Advanced Security**: SSH tunneling, credential rotation, role-based access control
6. **Monitoring & Observability**: Performance metrics, query statistics, connection pool health dashboard
7. **Query Builder Tool**: Optional tool to help construct complex queries with joins
8. **Schema Diff Tool**: Compare schemas between databases or track schema changes
9. **Data Export**: Export query results to CSV/Excel formats
10. **Safe DDL Mode**: Additional environment variable to allow safe DDL operations (CREATE TABLE, ALTER TABLE ADD COLUMN)

## Success Criteria

The MySQL MCP Server will be considered successful when:

1. **Schema Discovery**: LLMs can autonomously explore and understand database schemas via MCP resources
2. **Query Execution**: LLMs can write and execute complex SQL queries with full SQL expressiveness
3. **Safety First**: Read-only mode is secure by default, blocking dangerous operations through query parsing
4. **Write Capability**: Write mode can be safely enabled for data manipulation when needed
5. **Fully Qualified Names**: LLMs understand and use `database.table` format consistently
6. **Resource Efficiency**: MCP resources provide efficient access to schema metadata without tool calls
7. **Clear Guidance**: Error messages guide LLMs toward correct SQL patterns and proper usage
8. **Robust Parsing**: Query parser correctly identifies and blocks dangerous operations reliably
9. **Performance**: Handles real-world databases (100+ tables) with acceptable performance
10. **Best Practices**: Follows all MCP and TypeScript best practices throughout
11. **Easy Integration**: Works seamlessly with Claude Desktop and other MCP clients
12. **Self-Serve Documentation**: Users can get started quickly with clear documentation

## Acceptance Criteria

### Core Functionality
- [ ] All REQ-* requirements are implemented
- [ ] Server builds successfully with `npm run build`
- [ ] Server runs without errors when properly configured
- [ ] Server logs operation mode (READ-ONLY or WRITE ENABLED) on startup

### Tools and Resources
- [ ] `mysql_query` tool is registered and fully functional
- [ ] Query tool has comprehensive description with SQL examples
- [ ] Query tool supports both JSON and Markdown response formats
- [ ] MCP resources are registered for databases and tables (`mysql://` URIs)
- [ ] Resources support dynamic discovery via `resources/list`
- [ ] Resources return schema metadata in JSON and Markdown formats

### Query Execution and Safety
- [ ] Query parser correctly identifies SELECT, INSERT, UPDATE, DELETE operations
- [ ] Query parser blocks dangerous DDL (DROP, TRUNCATE) in all modes
- [ ] Query parser blocks administrative commands (GRANT, REVOKE) in all modes
- [ ] Read-only mode blocks write operations (INSERT, UPDATE, DELETE)
- [ ] Write mode allows DML operations when `MYSQL_ALLOW_WRITE=true`
- [ ] Multi-statement queries are properly analyzed and blocked if any statement is disallowed
- [ ] Blocked operations return clear error messages with mode information

### Data Handling
- [ ] Large result sets are truncated at CHARACTER_LIMIT (25,000 chars)
- [ ] Truncation messages suggest optimization strategies (LIMIT, WHERE)
- [ ] Markdown format produces well-formatted tables
- [ ] JSON format includes proper metadata (executionTime, rowCount, etc.)
- [ ] Fully qualified table names (`database.table`) are required and validated

### Connection and Configuration
- [ ] Connection pooling is properly configured using mysql2
- [ ] Environment variables are validated on startup
- [ ] Missing required environment variables cause clear error messages
- [ ] SSL/TLS connections are supported with proper certificate handling
- [ ] Query timeouts are enforced via `MYSQL_QUERY_TIMEOUT`
- [ ] Connection timeouts are enforced via `MYSQL_CONNECTION_TIMEOUT`

### Error Handling
- [ ] All errors are returned as MCP tool errors (not protocol-level)
- [ ] Error messages are clear, actionable, and educational
- [ ] Sensitive credentials are never exposed in errors or logs
- [ ] Connection failures provide actionable troubleshooting guidance
- [ ] Permission errors indicate which database/table is inaccessible

### Code Quality
- [ ] Code follows all TypeScript best practices (strict mode, no `any`)
- [ ] Code follows all MCP best practices (naming, annotations, descriptions)
- [ ] No code duplication; shared utilities are used throughout
- [ ] Proper separation of concerns (tools/, services/, schemas/, types.ts)
- [ ] All async operations use async/await consistently

### Documentation
- [ ] README includes installation, configuration, and usage instructions
- [ ] All environment variables are documented with defaults
- [ ] Security considerations are clearly documented
- [ ] SQL examples are provided for common use cases
- [ ] Troubleshooting guide covers common issues
