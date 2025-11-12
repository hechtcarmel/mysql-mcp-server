# MySQL MCP Server - Implementation Tasks

**Last Updated**: 2025-11-12
**Current Phase**: Phase 1 - Core Infrastructure
**Overall Progress**: 0/87 tasks completed (0%)

---

## Task Status Legend

- ⬜ **Not Started**: Task not yet begun
- 🔄 **In Progress**: Currently being worked on
- ✅ **Completed**: Task finished and verified
- 🚫 **Blocked**: Cannot proceed due to dependency or issue
- ⚠️ **Needs Review**: Completed but requires validation

---

## Phase 1: Core Infrastructure (Foundation)

**Goal**: Set up project structure, connection pooling, configuration
**Progress**: 0/22 tasks completed (0%)

### 1.1 Project Structure Setup

- ⬜ **TASK-001**: Initialize npm project with `npm init`
  - Create package.json with project metadata
  - Set project name: `mysql-mcp-server`
  - Set version: `1.0.0`
  - Set description, author, license fields

- ⬜ **TASK-002**: Install core dependencies
  ```bash
  npm install @modelcontextprotocol/sdk mysql2 zod
  ```

- ⬜ **TASK-003**: Install development dependencies
  ```bash
  npm install -D @types/node typescript tsx
  ```

- ⬜ **TASK-004**: Create `tsconfig.json` with strict configuration
  - Enable strict mode
  - Set target to ES2022
  - Configure module as Node16
  - Set outDir to ./dist
  - Set rootDir to ./src

- ⬜ **TASK-005**: Create directory structure
  ```
  src/
  ├── index.ts
  ├── constants.ts
  ├── types.ts
  ├── services/
  ├── schemas/
  ├── tools/
  ├── resources/
  └── utils/
  ```

- ⬜ **TASK-006**: Create `.env.example` file
  - Document all environment variables
  - Provide example values
  - Include comments explaining each variable

- ⬜ **TASK-007**: Add `.gitignore` file
  - Ignore node_modules/
  - Ignore dist/
  - Ignore .env (but not .env.example)
  - Ignore IDE files

- ⬜ **TASK-008**: Configure npm scripts in package.json
  - `"build": "tsc"`
  - `"start": "node dist/index.js"`
  - `"dev": "tsx watch src/index.ts"`
  - `"clean": "rm -rf dist"`

### 1.2 Configuration Management

- ⬜ **TASK-009**: Create `src/constants.ts`
  - Define CHARACTER_LIMIT = 25000
  - Define DEFAULT_PORT = 3306
  - Define DEFAULT_POOL_SIZE = 10
  - Define DEFAULT_CONNECTION_TIMEOUT = 10000
  - Define DEFAULT_QUERY_TIMEOUT = 30000

- ⬜ **TASK-010**: Create `src/types.ts`
  - Define OperationMode enum (READ_ONLY, WRITE_ENABLED)
  - Define QueryType enum
  - Define ServerConfig interface
  - Define MySQL connection config interface
  - Define QueryResult interface
  - Define TableSchema interface

- ⬜ **TASK-011**: Implement config loader in `src/services/config-loader.ts`
  - Load environment variables
  - Support MYSQL_ENV_FILE for .env file loading
  - Validate required variables (HOST, USER, PASSWORD)
  - Parse boolean values (MYSQL_ALLOW_WRITE)
  - Parse numeric values with defaults
  - Return typed ServerConfig object

- ⬜ **TASK-012**: Implement config validation
  - Check all required env vars are present
  - Validate numeric values are positive
  - Validate port is in valid range (1-65535)
  - Throw clear errors for missing/invalid config

- ⬜ **TASK-013**: Add config logging on startup
  - Log operation mode (READ-ONLY or WRITE ENABLED)
  - Log connection host and port (NOT password)
  - Log pool size and timeouts
  - Log SSL configuration status
  - Add warning when MYSQL_ALLOW_WRITE=true

### 1.3 MySQL Connection Pool

- ⬜ **TASK-014**: Create `src/services/mysql-client.ts` skeleton
  - Import mysql2/promise
  - Define MySQLClient class
  - Define connection pool property
  - Define initialization method signature

- ⬜ **TASK-015**: Implement connection pool creation
  - Use mysql2.createPool() with promise wrapper
  - Configure host, port, user, password
  - Configure connectionLimit from MYSQL_POOL_SIZE
  - Configure connectTimeout
  - Configure waitForConnections: true
  - Configure queueLimit: 0
  - Configure enableKeepAlive: true
  - Configure keepAliveInitialDelay: 0

- ⬜ **TASK-016**: Implement SSL/TLS configuration
  - Check if MYSQL_SSL_CA is provided
  - Load SSL certificate files if present
  - Configure ssl object with ca, cert, key
  - Configure rejectUnauthorized from env var

- ⬜ **TASK-017**: Implement connection health check
  - Method: `async testConnection()`
  - Execute simple query: `SELECT 1`
  - Return true on success, false on failure
  - Log connection status

- ⬜ **TASK-018**: Implement query execution wrapper
  - Method: `async executeQuery(sql: string)`
  - Acquire connection from pool automatically
  - Set query timeout from MYSQL_QUERY_TIMEOUT
  - Execute query with timeout
  - Release connection (even on error)
  - Return typed result

- ⬜ **TASK-019**: Implement connection pool cleanup
  - Method: `async close()`
  - End all connections in pool
  - Wait for graceful shutdown
  - Log shutdown status

### 1.4 Logging Infrastructure

- ⬜ **TASK-020**: Create `src/utils/logger.ts`
  - Implement logInfo(message: string)
  - Implement logWarning(message: string)
  - Implement logError(message: string, error?: unknown)
  - All logging to stderr (console.error)
  - Include timestamp in ISO format
  - Include log level prefix

- ⬜ **TASK-021**: Implement query audit logging
  - Function: `logQuery(query: string, mode: OperationMode, allowed: boolean)`
  - Truncate query to 200 chars for log safety
  - Include execution status (EXECUTED or BLOCKED)
  - Include operation mode
  - Format as structured log entry

- ⬜ **TASK-022**: Create main entry point `src/index.ts`
  - Import MCP SDK components
  - Import config loader
  - Import MySQL client
  - Import logger
  - Load configuration
  - Initialize MySQL connection pool
  - Test database connection
  - Log server startup info
  - Create placeholder for MCP server initialization

---

## Phase 2: Query Parser (Safety Foundation)

**Goal**: Implement robust SQL query parsing and validation
**Progress**: 0/18 tasks completed (0%)

### 2.1 Query Normalization

- ⬜ **TASK-023**: Create `src/services/query-parser.ts` skeleton
  - Define QueryType enum (if not in types.ts)
  - Define ParseResult interface
  - Define QueryParser class

- ⬜ **TASK-024**: Implement comment removal
  - Function: `removeComments(query: string): string`
  - Remove single-line comments (-- to end of line)
  - Remove multi-line comments (/* ... */)
  - Handle nested comments
  - Handle comments in strings (don't remove)

- ⬜ **TASK-025**: Implement whitespace normalization
  - Function: `normalizeWhitespace(query: string): string`
  - Trim leading/trailing whitespace
  - Collapse multiple spaces to single space
  - Preserve spaces in string literals
  - Handle newlines and tabs

- ⬜ **TASK-026**: Implement statement splitting
  - Function: `splitStatements(query: string): string[]`
  - Split on semicolons
  - Ignore semicolons in string literals
  - Ignore semicolons in comments
  - Return array of individual statements

- ⬜ **TASK-027**: Implement full normalization pipeline
  - Function: `normalizeQuery(query: string): string`
  - Apply removeComments()
  - Apply normalizeWhitespace()
  - Return normalized query

### 2.2 Query Type Detection

- ⬜ **TASK-028**: Implement keyword extraction
  - Function: `extractFirstKeyword(statement: string): string`
  - Convert to uppercase
  - Extract first SQL keyword
  - Handle WITH clauses (CTEs)
  - Return primary operation keyword

- ⬜ **TASK-029**: Implement query type mapping
  - Function: `detectQueryType(statement: string): QueryType`
  - Map SELECT → QueryType.SELECT
  - Map INSERT → QueryType.INSERT
  - Map UPDATE → QueryType.UPDATE
  - Map DELETE → QueryType.DELETE
  - Map REPLACE → QueryType.REPLACE
  - Map CREATE → QueryType.CREATE
  - Map ALTER → QueryType.ALTER
  - Map DROP → QueryType.DROP
  - Map TRUNCATE → QueryType.TRUNCATE
  - Map START/BEGIN → QueryType.START_TRANSACTION
  - Map COMMIT → QueryType.COMMIT
  - Map ROLLBACK → QueryType.ROLLBACK
  - Map GRANT → QueryType.GRANT
  - Map REVOKE → QueryType.REVOKE
  - Map SHOW → QueryType.SHOW
  - Map DESCRIBE/DESC → QueryType.DESCRIBE
  - Map EXPLAIN → QueryType.EXPLAIN
  - Default → QueryType.UNKNOWN

- ⬜ **TASK-030**: Handle edge cases in detection
  - CTEs with WITH keyword
  - Subqueries in SELECT
  - UNION queries
  - Compound statements

### 2.3 Validation Rules

- ⬜ **TASK-031**: Define operation allowlists
  - Constant: ALWAYS_ALLOWED = [SELECT, SHOW, DESCRIBE, EXPLAIN]
  - Constant: NEVER_ALLOWED = [DROP, TRUNCATE, GRANT, REVOKE, FLUSH, KILL, LOAD_DATA]
  - Constant: WRITE_MODE_ALLOWED = [INSERT, UPDATE, DELETE, REPLACE, START_TRANSACTION, COMMIT, ROLLBACK, SAVEPOINT]

- ⬜ **TASK-032**: Implement validation logic
  - Function: `isAllowed(queryType: QueryType, mode: OperationMode): boolean`
  - Check ALWAYS_ALLOWED first (return true)
  - Check NEVER_ALLOWED next (return false)
  - Check WRITE_MODE_ALLOWED if mode === WRITE_ENABLED
  - Default to false for unknown operations

- ⬜ **TASK-033**: Implement error message generation
  - Function: `explainBlocked(queryType: QueryType, mode: OperationMode): string`
  - Generate specific messages for each query type
  - Include current operation mode in message
  - Suggest enabling write mode if applicable
  - Explain why dangerous operations are blocked

- ⬜ **TASK-034**: Implement suggestion generation
  - Function: `suggestFix(queryType: QueryType, mode: OperationMode): string`
  - Suggest setting MYSQL_ALLOW_WRITE=true for DML
  - Suggest using MySQL CLI for DDL
  - Suggest alternatives for blocked operations

### 2.4 Main Parser Interface

- ⬜ **TASK-035**: Implement main parsing function
  - Function: `parseQuery(query: string, mode: OperationMode): ParseResult`
  - Normalize query
  - Split into statements
  - Detect type for each statement
  - Validate each statement
  - Return first blocked result or success
  - Include query type, allowed flag, reason, suggestion

- ⬜ **TASK-036**: Add parser logging
  - Log normalized query (truncated)
  - Log detected query type
  - Log validation result
  - Log block reason if applicable

### 2.5 Parser Testing

- ⬜ **TASK-037**: Test SELECT queries
  - Simple SELECT
  - SELECT with JOIN
  - SELECT with subquery
  - SELECT with CTE (WITH clause)
  - SHOW statements
  - DESCRIBE statements
  - EXPLAIN statements

- ⬜ **TASK-038**: Test write operations in read-only mode
  - INSERT → should block
  - UPDATE → should block
  - DELETE → should block
  - REPLACE → should block
  - Verify error messages are clear

- ⬜ **TASK-039**: Test write operations in write mode
  - INSERT → should allow
  - UPDATE → should allow
  - DELETE → should allow
  - REPLACE → should allow
  - Transactions → should allow

- ⬜ **TASK-040**: Test dangerous operations
  - DROP DATABASE → should block in all modes
  - DROP TABLE → should block in all modes
  - TRUNCATE → should block in all modes
  - GRANT → should block in all modes
  - REVOKE → should block in all modes

---

## Phase 3: Query Tool Implementation

**Goal**: Implement `mysql_query` tool with full functionality
**Progress**: 0/17 tasks completed (0%)

### 3.1 Schema Definition

- ⬜ **TASK-041**: Create `src/schemas/tool-schemas.ts`
  - Import zod
  - Define ResponseFormat enum

- ⬜ **TASK-042**: Implement QueryInputSchema
  - Field: query (string, required, min 1, max 10000)
  - Field: response_format (enum, optional, default 'markdown')
  - Add .strict() validation
  - Add descriptive field descriptions
  - Export schema and inferred type

### 3.2 Query Executor

- ⬜ **TASK-043**: Create `src/services/query-executor.ts`
  - Import MySQLClient
  - Import QueryParser
  - Define QueryExecutor class

- ⬜ **TASK-044**: Implement query execution
  - Method: `async executeQuery(query: string, mode: OperationMode)`
  - Parse query first (validate with parser)
  - If blocked, return error result
  - If allowed, execute via MySQLClient
  - Measure execution time
  - Return typed result with metadata

- ⬜ **TASK-045**: Implement timeout handling
  - Wrap execution with timeout
  - Use MYSQL_QUERY_TIMEOUT from config
  - Throw TimeoutError if exceeded
  - Include helpful error message

- ⬜ **TASK-046**: Implement result metadata
  - Include executionTime (ms)
  - Include rowCount (for DML)
  - Include affectedRows (for DML)
  - Include insertId (for INSERT)
  - Include warnings (if any)

### 3.3 Response Formatters

- ⬜ **TASK-047**: Create `src/utils/formatters.ts`
  - Define formatter functions
  - Import types for results

- ⬜ **TASK-048**: Implement JSON formatter
  - Function: `formatAsJSON(result: QueryResult): string`
  - Structure: { columns, rows, metadata }
  - Include column names and types
  - Include all metadata (executionTime, rowCount, etc.)
  - Pretty print with JSON.stringify(result, null, 2)

- ⬜ **TASK-049**: Implement Markdown formatter for SELECT
  - Function: `formatAsMarkdown(result: QueryResult, queryType: QueryType): string`
  - Generate markdown table for SELECT results
  - Include header row with column names
  - Include separator row with alignment
  - Include data rows
  - Add metadata footer (execution time, row count)

- ⬜ **TASK-050**: Implement Markdown formatter for DML
  - Handle INSERT results (affected rows, insert ID)
  - Handle UPDATE results (affected rows)
  - Handle DELETE results (affected rows)
  - Format as human-readable message with metadata

- ⬜ **TASK-051**: Implement truncation logic
  - Function: `applyCharacterLimit(response: string): string`
  - Check if length > CHARACTER_LIMIT (25000)
  - If yes, truncate response
  - Calculate how many rows to include
  - Add truncation warning message
  - Suggest using LIMIT clause
  - Suggest adding WHERE filters

### 3.4 Error Handling

- ⬜ **TASK-052**: Create `src/utils/error-handlers.ts`
  - Import MySQL2 error types
  - Define error handling functions

- ⬜ **TASK-053**: Implement MySQL error handler
  - Function: `handleMySQLError(error: MySQL2Error): string`
  - Handle ER_NO_SUCH_TABLE (suggest SHOW TABLES)
  - Handle ER_BAD_DB_ERROR (suggest SHOW DATABASES)
  - Handle ER_ACCESS_DENIED_ERROR (explain permissions)
  - Handle ER_PARSE_ERROR (show syntax error)
  - Handle ER_DUP_ENTRY (explain unique constraint)
  - Handle ER_LOCK_WAIT_TIMEOUT (suggest retry)
  - Default handler for unknown errors

- ⬜ **TASK-054**: Implement timeout error handler
  - Function: `handleTimeoutError(): string`
  - Explain timeout was exceeded
  - Suggest adding LIMIT
  - Suggest adding WHERE
  - Suggest optimizing query
  - Suggest increasing MYSQL_QUERY_TIMEOUT

- ⬜ **TASK-055**: Implement validation error handler
  - Function: `handleValidationError(error: ZodError): string`
  - Format Zod error issues
  - List each validation failure
  - Provide clear field-level errors

### 3.5 Tool Registration

- ⬜ **TASK-056**: Create `src/tools/query-tool.ts`
  - Import MCP SDK types
  - Import QueryInputSchema
  - Import QueryExecutor
  - Import formatters and error handlers

- ⬜ **TASK-057**: Write comprehensive tool description
  - Explain tool purpose and operation mode
  - Document query requirements (fully qualified names)
  - List allowed/blocked operations for current mode
  - Provide parameter documentation with examples
  - Include return value schema documentation
  - Add usage examples (5+ examples)
  - Add error handling documentation
  - Add performance tips

- ⬜ **TASK-058**: Implement tool handler function
  - Parse input with Zod schema
  - Call query executor
  - Format result based on response_format
  - Apply character limit truncation
  - Handle all errors with appropriate handlers
  - Return MCP tool result

- ⬜ **TASK-059**: Register tool with MCP server
  - In src/index.ts, import query tool
  - Call server.registerTool()
  - Set tool name: 'mysql_query'
  - Set tool title, description, inputSchema
  - Set annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
  - Wire up tool handler

---

## Phase 4: MCP Resources Implementation

**Goal**: Expose databases and tables as MCP resources
**Progress**: 0/15 tasks completed (0%)

### 4.1 Metadata Service

- ⬜ **TASK-060**: Create `src/services/metadata-service.ts`
  - Import MySQLClient
  - Define MetadataService class
  - Define interfaces for metadata responses

- ⬜ **TASK-061**: Implement list databases
  - Method: `async listDatabases()`
  - Query INFORMATION_SCHEMA.SCHEMATA
  - Exclude system databases (information_schema, performance_schema, mysql, sys)
  - Return array of database info (name, charset, collation, table count)

- ⬜ **TASK-062**: Implement get database info
  - Method: `async getDatabaseInfo(database: string)`
  - Query INFORMATION_SCHEMA.SCHEMATA for specific database
  - Query INFORMATION_SCHEMA.TABLES for table list
  - Return database metadata + table list

- ⬜ **TASK-063**: Implement get table schema
  - Method: `async getTableSchema(database: string, table: string)`
  - Query INFORMATION_SCHEMA.TABLES for table info
  - Query INFORMATION_SCHEMA.COLUMNS for columns
  - Query INFORMATION_SCHEMA.STATISTICS for indexes
  - Query INFORMATION_SCHEMA.KEY_COLUMN_USAGE for foreign keys
  - Combine into complete TableSchema object

- ⬜ **TASK-064**: Add error handling for metadata queries
  - Handle database not found
  - Handle table not found
  - Handle permission denied
  - Return clear error messages

### 4.2 Resource Formatters

- ⬜ **TASK-065**: Add resource formatters to `src/utils/formatters.ts`
  - Function: `formatDatabaseListAsMarkdown(databases: DatabaseInfo[])`
  - Function: `formatDatabaseListAsJSON(databases: DatabaseInfo[])`
  - Function: `formatDatabaseAsMarkdown(info: DatabaseResource)`
  - Function: `formatDatabaseAsJSON(info: DatabaseResource)`
  - Function: `formatTableSchemaAsMarkdown(schema: TableSchema)`
  - Function: `formatTableSchemaAsJSON(schema: TableSchema)`

- ⬜ **TASK-066**: Implement database list markdown formatter
  - Create table with columns: Name, Charset, Collation, Tables
  - Include total database count
  - Format as readable markdown table

- ⬜ **TASK-067**: Implement table schema markdown formatter
  - Section: Table Info (name, type, engine, rows, size)
  - Section: Columns (name, type, nullable, key, default, comment)
  - Section: Indexes (name, unique, columns, type)
  - Section: Foreign Keys (name, columns, references)
  - Format each section as markdown table
  - Use clear headers and formatting

### 4.3 Resource Handlers

- ⬜ **TASK-068**: Create `src/resources/database-resource.ts`
  - Define URI patterns
  - Import MetadataService and formatters

- ⬜ **TASK-069**: Implement database list resource handler
  - URI: `mysql://databases`
  - Call MetadataService.listDatabases()
  - Format as markdown (default)
  - Return resource content

- ⬜ **TASK-070**: Implement single database resource handler
  - URI pattern: `mysql://{database}`
  - Extract database name from URI
  - Call MetadataService.getDatabaseInfo()
  - Format as markdown (default)
  - Return resource content
  - Handle errors (database not found)

- ⬜ **TASK-071**: Create `src/resources/table-resource.ts`
  - Define URI pattern
  - Import MetadataService and formatters

- ⬜ **TASK-072**: Implement table schema resource handler
  - URI pattern: `mysql://{database}/{table}`
  - Extract database and table names from URI
  - Call MetadataService.getTableSchema()
  - Format as markdown (default)
  - Return resource content
  - Handle errors (table not found)

### 4.4 Resource Registration

- ⬜ **TASK-073**: Register resources in `src/index.ts`
  - Import resource handlers
  - Register database list resource
  - Register database resource with URI template
  - Register table resource with URI template

- ⬜ **TASK-074**: Implement resource discovery
  - Implement resources/list handler
  - Return list of available resources
  - Include `mysql://databases` resource
  - Dynamically enumerate database resources
  - Note: Table resources discovered via URI pattern (too many to enumerate)

---

## Phase 5: Testing and Refinement

**Goal**: Comprehensive testing and documentation
**Progress**: 0/10 tasks completed (0%)

### 5.1 Integration Testing

- ⬜ **TASK-075**: Test query tool with read-only mode
  - Execute SELECT queries
  - Execute SHOW TABLES
  - Execute DESCRIBE table
  - Verify INSERT/UPDATE/DELETE are blocked
  - Verify error messages are clear

- ⬜ **TASK-076**: Test query tool with write mode
  - Set MYSQL_ALLOW_WRITE=true
  - Execute INSERT queries
  - Execute UPDATE queries
  - Execute DELETE queries
  - Verify DDL (DROP, TRUNCATE) still blocked
  - Verify transactions work

- ⬜ **TASK-077**: Test resources
  - Access `mysql://databases`
  - Access `mysql://{database}` for various databases
  - Access `mysql://{database}/{table}` for various tables
  - Verify markdown formatting is readable
  - Test resource discovery (resources/list)

- ⬜ **TASK-078**: Test error scenarios
  - Invalid database name
  - Invalid table name
  - Permission denied errors
  - Connection failures
  - Query syntax errors
  - Query timeouts

### 5.2 Performance Testing

- ⬜ **TASK-079**: Test with large result sets
  - Query returning 1000+ rows
  - Verify truncation works correctly
  - Verify truncation message is helpful
  - Test LIMIT clause works as suggested

- ⬜ **TASK-080**: Test query timeouts
  - Create slow query (e.g., SLEEP(35))
  - Verify timeout is enforced
  - Verify error message is helpful

- ⬜ **TASK-081**: Test connection pool under load
  - Execute multiple concurrent queries
  - Verify connection pool handles load
  - Verify connections are properly released
  - Verify no connection leaks

### 5.3 Documentation

- ⬜ **TASK-082**: Write comprehensive README.md
  - Installation section (npm install steps)
  - Configuration section (all env vars with examples)
  - Usage section (how to add to Claude Desktop)
  - Examples section (sample queries and resources)
  - Security section (read-only mode, write mode, query parsing)
  - Troubleshooting section (common issues and fixes)
  - Contributing section (how to contribute)

- ⬜ **TASK-083**: Create example .env file
  - Copy from .env.example
  - Fill with realistic values
  - Add comments for each variable

- ⬜ **TASK-084**: Create example MCP client configuration
  - Example for Claude Desktop (JSON config)
  - Example command line invocation
  - Show both read-only and write mode configs

---

## Phase 6: Polish and Release

**Goal**: Final refinements and public release
**Progress**: 0/5 tasks completed (0%)

### 6.1 Code Review

- ⬜ **TASK-085**: Final code quality check
  - Remove any debug logging
  - Remove commented-out code
  - Verify no `any` types remain
  - Check for code duplication
  - Verify consistent error handling
  - Verify all async functions have proper types

### 6.2 Build Verification

- ⬜ **TASK-086**: Test build process
  - Run `npm run clean`
  - Run `npm run build`
  - Verify dist/index.js is created
  - Verify no build errors
  - Test running: `node dist/index.js`
  - Verify server starts without errors

### 6.3 Release Preparation

- ⬜ **TASK-087**: Prepare for release
  - Update version in package.json
  - Create LICENSE file (MIT or chosen license)
  - Create CHANGELOG.md with v1.0.0 changes
  - Tag release: `git tag v1.0.0`
  - Push tags: `git push --tags`

---

## Current Sprint

**Active Tasks**: None yet
**Blocked Tasks**: None
**Next Up**: TASK-001 through TASK-008 (Project Structure Setup)

---

## Dependencies and Blockers

### Phase Dependencies
- Phase 2 depends on Phase 1 (requires MySQL client and config)
- Phase 3 depends on Phase 2 (requires query parser)
- Phase 4 can be done in parallel with Phase 3
- Phase 5 depends on Phases 3 & 4 (requires tools and resources)
- Phase 6 depends on Phase 5 (requires testing complete)

### Task-Level Dependencies
- TASK-015 depends on TASK-011 (config needed for pool)
- TASK-035 depends on TASK-024-034 (all parser components)
- TASK-044 depends on TASK-035 (needs parser)
- TASK-073 depends on TASK-060-064 (needs metadata service)

---

## Progress Tracking

### By Phase
| Phase | Description | Tasks | Completed | Progress |
|-------|-------------|-------|-----------|----------|
| 1 | Core Infrastructure | 22 | 0 | 0% |
| 2 | Query Parser | 18 | 0 | 0% |
| 3 | Query Tool | 17 | 0 | 0% |
| 4 | MCP Resources | 15 | 0 | 0% |
| 5 | Testing & Docs | 10 | 0 | 0% |
| 6 | Polish & Release | 5 | 0 | 0% |
| **Total** | | **87** | **0** | **0%** |

### Weekly Goals
- **Week 1**: Complete Phase 1 & 2 (Foundation + Parser)
- **Week 2**: Complete Phase 3 & 4 (Tools + Resources)
- **Week 3**: Complete Phase 5 & 6 (Testing + Release)

---

## Notes

- Update this file as tasks are completed
- Mark tasks as ✅ when fully done and tested
- Add notes/blockers under tasks if issues arise
- Keep "Last Updated" date current
- Update progress percentages after each task

---

## Quick Commands

### Start Development
```bash
npm install
npm run dev
```

### Build and Test
```bash
npm run build
node dist/index.js
```

### Check Task Status
```bash
grep -c "⬜" tasks.md  # Count not started
grep -c "✅" tasks.md  # Count completed
```
