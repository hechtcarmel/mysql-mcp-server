# MySQL MCP Server - Design Document

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [System Components](#system-components)
3. [Query Parser Design](#query-parser-design)
4. [MCP Resources Design](#mcp-resources-design)
5. [Tool Design](#tool-design)
6. [Data Flow](#data-flow)
7. [Error Handling Strategy](#error-handling-strategy)
8. [Security Model](#security-model)
9. [Implementation Plan](#implementation-plan)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client (Claude)                     │
└────────────────────┬────────────────────────────────────────┘
                     │ MCP Protocol (stdio)
                     │
┌────────────────────▼────────────────────────────────────────┐
│                   MySQL MCP Server                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              MCP Server Core                            │ │
│  │  - Tool Registration (mysql_query)                      │ │
│  │  - Resource Registration (mysql:// URIs)                │ │
│  │  - Request Routing                                      │ │
│  └────┬──────────────────────────────┬────────────────────┘ │
│       │                               │                       │
│  ┌────▼──────────────┐         ┌──────▼──────────────────┐ │
│  │  Query Executor   │         │  Resource Manager       │ │
│  │  - Parse Query    │         │  - List Databases       │ │
│  │  - Validate Mode  │         │  - Get Table Schema     │ │
│  │  - Execute SQL    │         │  - Format Metadata      │ │
│  │  - Format Results │         └──────┬──────────────────┘ │
│  └────┬──────────────┘                │                     │
│       │                                │                     │
│  ┌────▼────────────────────────────────▼────────────────┐  │
│  │         MySQL Connection Pool Manager                 │  │
│  │  - Pool Configuration                                 │  │
│  │  - Connection Lifecycle                               │  │
│  │  - Timeout Management                                 │  │
│  └────┬──────────────────────────────────────────────────┘ │
└───────┼──────────────────────────────────────────────────────┘
        │ MySQL Protocol (TCP/SSL)
        │
┌───────▼──────────────────────────────────────────────────────┐
│                      MySQL Database                           │
│  - Multiple Databases/Schemas                                │
│  - Tables, Views, Procedures                                 │
│  - INFORMATION_SCHEMA for metadata                           │
└───────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Query-Based Operations**: Single unified query tool instead of per-operation tools
2. **Parse-Time Safety**: Query validation through intelligent parsing rather than separate tools
3. **Resource-First Discovery**: MCP resources as primary mechanism for schema exploration
4. **Fully Qualified Names**: All queries must use `database.table` format
5. **Secure by Default**: Read-only mode as default, write mode explicitly enabled
6. **TypeScript Strict**: Full type safety throughout the codebase

---

## System Components

### Directory Structure

```
mysql-mcp-server/
├── src/
│   ├── index.ts                    # Main entry point, server initialization
│   ├── constants.ts                # Configuration constants
│   ├── types.ts                    # TypeScript type definitions
│   │
│   ├── services/
│   │   ├── mysql-client.ts         # Connection pool manager
│   │   ├── query-parser.ts         # SQL query parser and validator
│   │   ├── query-executor.ts       # Query execution logic
│   │   └── metadata-service.ts     # Database/table metadata retrieval
│   │
│   ├── schemas/
│   │   └── tool-schemas.ts         # Zod schemas for tool inputs
│   │
│   ├── tools/
│   │   └── query-tool.ts           # mysql_query tool implementation
│   │
│   ├── resources/
│   │   ├── database-resource.ts    # Database resource handler
│   │   └── table-resource.ts       # Table resource handler
│   │
│   └── utils/
│       ├── formatters.ts           # Response formatters (JSON/Markdown)
│       ├── error-handlers.ts       # Error handling utilities
│       └── validators.ts           # Input validation helpers
│
├── dist/                           # Compiled JavaScript output
├── package.json
├── tsconfig.json
├── .env.example                    # Environment variable template
└── README.md
```

### Component Responsibilities

#### 1. **MCP Server Core** (`src/index.ts`)
- Initialize MCP server with stdio transport
- Load and validate environment variables
- Register `mysql_query` tool
- Register MCP resources for databases and tables
- Set up error handlers
- Log server mode (READ-ONLY or WRITE ENABLED)

#### 2. **MySQL Client** (`src/services/mysql-client.ts`)
- Create and manage mysql2 connection pool
- Configure pool settings (size, timeouts, keep-alive)
- Provide connection acquisition interface
- Handle SSL/TLS configuration
- Implement connection health checks
- Log connection events to stderr

#### 3. **Query Parser** (`src/services/query-parser.ts`)
- Parse SQL queries to detect operation type
- Validate queries against current server mode
- Block dangerous operations based on rules
- Handle multi-statement queries
- Strip comments and normalize whitespace
- Return clear validation results

#### 4. **Query Executor** (`src/services/query-executor.ts`)
- Execute validated SQL queries
- Measure execution time
- Handle query timeouts
- Format results (JSON/Markdown)
- Apply CHARACTER_LIMIT truncation
- Return query metadata

#### 5. **Metadata Service** (`src/services/metadata-service.ts`)
- Query INFORMATION_SCHEMA for metadata
- List all accessible databases
- Get table lists for databases
- Retrieve complete table schemas
- Fetch index and foreign key information
- Format metadata for resources

#### 6. **Tool Implementation** (`src/tools/query-tool.ts`)
- Define `mysql_query` tool
- Zod schema for query parameters
- Tool description with SQL examples
- Call query parser and executor
- Return formatted results or errors

#### 7. **Resource Handlers** (`src/resources/`)
- Implement resource URI patterns
- Handle `mysql://databases` (list all)
- Handle `mysql://{database}` (database info + tables)
- Handle `mysql://{database}/{table}` (table schema)
- Support dynamic resource discovery
- Format responses in JSON/Markdown

---

## Query Parser Design

### Parser Objectives

1. Detect the type of SQL operation (SELECT, INSERT, UPDATE, etc.)
2. Validate operation is allowed in current server mode
3. Block dangerous operations reliably
4. Provide clear error messages for blocked queries
5. Handle edge cases (comments, multi-statement, subqueries)

### Query Type Detection

#### Parsing Strategy

```typescript
enum QueryType {
  SELECT = 'SELECT',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  REPLACE = 'REPLACE',

  // DDL
  CREATE = 'CREATE',
  ALTER = 'ALTER',
  DROP = 'DROP',
  TRUNCATE = 'TRUNCATE',

  // Transaction
  START_TRANSACTION = 'START_TRANSACTION',
  COMMIT = 'COMMIT',
  ROLLBACK = 'ROLLBACK',
  SAVEPOINT = 'SAVEPOINT',

  // Administrative
  GRANT = 'GRANT',
  REVOKE = 'REVOKE',
  FLUSH = 'FLUSH',
  KILL = 'KILL',
  LOAD_DATA = 'LOAD_DATA',
  SET = 'SET',

  // Read-only utility
  SHOW = 'SHOW',
  DESCRIBE = 'DESCRIBE',
  EXPLAIN = 'EXPLAIN',
  USE = 'USE',

  UNKNOWN = 'UNKNOWN'
}

enum OperationMode {
  READ_ONLY = 'READ_ONLY',
  WRITE_ENABLED = 'WRITE_ENABLED'
}

interface ParseResult {
  queryType: QueryType;
  allowed: boolean;
  reason?: string;
  suggestion?: string;
}
```

#### Parsing Algorithm

```typescript
function parseQuery(query: string, mode: OperationMode): ParseResult {
  // 1. Normalize query
  const normalized = normalizeQuery(query);

  // 2. Split into statements (handle semicolons)
  const statements = splitStatements(normalized);

  // 3. Parse each statement
  for (const stmt of statements) {
    const queryType = detectQueryType(stmt);
    const allowed = isAllowed(queryType, mode);

    if (!allowed) {
      return {
        queryType,
        allowed: false,
        reason: explainBlocked(queryType, mode),
        suggestion: suggestFix(queryType, mode)
      };
    }
  }

  return { queryType: statements[0].type, allowed: true };
}
```

### Normalization Process

```typescript
function normalizeQuery(query: string): string {
  // Remove SQL comments (-- and /* */)
  let normalized = query.replace(/--[^\n]*/g, '');
  normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove leading/trailing whitespace
  normalized = normalized.trim();

  // Collapse multiple whitespace
  normalized = normalized.replace(/\s+/g, ' ');

  return normalized;
}
```

### Query Type Detection

```typescript
function detectQueryType(statement: string): QueryType {
  // Convert to uppercase for keyword matching
  const upper = statement.toUpperCase();

  // Extract first keyword (ignoring WITH for CTEs)
  let firstKeyword = upper.split(/\s+/)[0];

  // Handle CTEs (WITH ... SELECT)
  if (firstKeyword === 'WITH') {
    const match = upper.match(/\bWITH\b.*?\b(SELECT|INSERT|UPDATE|DELETE)\b/);
    if (match) {
      firstKeyword = match[1];
    }
  }

  // Map keyword to QueryType
  switch (firstKeyword) {
    case 'SELECT':
      return QueryType.SELECT;
    case 'INSERT':
      return QueryType.INSERT;
    case 'UPDATE':
      return QueryType.UPDATE;
    case 'DELETE':
      return QueryType.DELETE;
    case 'REPLACE':
      return QueryType.REPLACE;
    case 'CREATE':
      return QueryType.CREATE;
    case 'ALTER':
      return QueryType.ALTER;
    case 'DROP':
      return QueryType.DROP;
    case 'TRUNCATE':
      return QueryType.TRUNCATE;
    case 'START':
      return QueryType.START_TRANSACTION;
    case 'COMMIT':
      return QueryType.COMMIT;
    case 'ROLLBACK':
      return QueryType.ROLLBACK;
    case 'GRANT':
      return QueryType.GRANT;
    case 'REVOKE':
      return QueryType.REVOKE;
    case 'SHOW':
      return QueryType.SHOW;
    case 'DESCRIBE':
    case 'DESC':
      return QueryType.DESCRIBE;
    case 'EXPLAIN':
      return QueryType.EXPLAIN;
    default:
      return QueryType.UNKNOWN;
  }
}
```

### Validation Rules

```typescript
function isAllowed(queryType: QueryType, mode: OperationMode): boolean {
  // Always allowed (read-only operations)
  const alwaysAllowed = [
    QueryType.SELECT,
    QueryType.SHOW,
    QueryType.DESCRIBE,
    QueryType.EXPLAIN
  ];

  if (alwaysAllowed.includes(queryType)) {
    return true;
  }

  // Never allowed (dangerous operations)
  const neverAllowed = [
    QueryType.DROP,
    QueryType.TRUNCATE,
    QueryType.GRANT,
    QueryType.REVOKE,
    QueryType.FLUSH,
    QueryType.KILL,
    QueryType.LOAD_DATA
  ];

  if (neverAllowed.includes(queryType)) {
    return false;
  }

  // Allowed only in write mode
  if (mode === OperationMode.WRITE_ENABLED) {
    const writeOperations = [
      QueryType.INSERT,
      QueryType.UPDATE,
      QueryType.DELETE,
      QueryType.REPLACE,
      QueryType.START_TRANSACTION,
      QueryType.COMMIT,
      QueryType.ROLLBACK,
      QueryType.SAVEPOINT
    ];

    if (writeOperations.includes(queryType)) {
      return true;
    }
  }

  // Default: block unknown operations
  return false;
}
```

### Error Messages

```typescript
function explainBlocked(queryType: QueryType, mode: OperationMode): string {
  if (mode === OperationMode.READ_ONLY) {
    switch (queryType) {
      case QueryType.INSERT:
      case QueryType.UPDATE:
      case QueryType.DELETE:
      case QueryType.REPLACE:
        return `${queryType} operations are not allowed in READ-ONLY mode. ` +
               `Set MYSQL_ALLOW_WRITE=true to enable write operations.`;

      case QueryType.DROP:
      case QueryType.TRUNCATE:
        return `${queryType} operations are dangerous and never allowed for safety.`;

      case QueryType.GRANT:
      case QueryType.REVOKE:
        return `Administrative commands (${queryType}) are never allowed.`;

      default:
        return `${queryType} operations are not allowed in READ-ONLY mode.`;
    }
  } else {
    // Write mode
    switch (queryType) {
      case QueryType.DROP:
      case QueryType.TRUNCATE:
        return `${queryType} operations are dangerous and blocked even in WRITE mode. ` +
               `Use MySQL CLI directly for destructive DDL operations.`;

      case QueryType.GRANT:
      case QueryType.REVOKE:
        return `Administrative commands (${queryType}) are never allowed for security.`;

      default:
        return `${queryType} operations are not recognized or not allowed.`;
    }
  }
}
```

---

## MCP Resources Design

### Resource URI Patterns

```
mysql://databases                  List all databases
mysql://{database}                 Database info + table list
mysql://{database}/{table}         Complete table schema
```

### Resource Implementation

#### 1. Database List Resource (`mysql://databases`)

**Purpose**: Enumerate all accessible databases

**Response Structure**:
```typescript
interface DatabaseListResource {
  databases: Array<{
    name: string;
    defaultCharacterSet: string;
    defaultCollation: string;
    tableCount: number;
  }>;
  totalCount: number;
}
```

**SQL Query**:
```sql
SELECT
  SCHEMA_NAME as name,
  DEFAULT_CHARACTER_SET_NAME as defaultCharacterSet,
  DEFAULT_COLLATION_NAME as defaultCollation,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = s.SCHEMA_NAME) as tableCount
FROM INFORMATION_SCHEMA.SCHEMATA s
WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
ORDER BY SCHEMA_NAME;
```

#### 2. Database Resource (`mysql://{database}`)

**Purpose**: Get database information and list of tables

**Response Structure**:
```typescript
interface DatabaseResource {
  database: {
    name: string;
    characterSet: string;
    collation: string;
  };
  tables: Array<{
    name: string;
    type: 'BASE TABLE' | 'VIEW';
    engine: string;
    rowCount: number;
    dataLength: number;
    indexLength: number;
    comment: string;
  }>;
  tableCount: number;
}
```

**SQL Query**:
```sql
-- Database info
SELECT
  SCHEMA_NAME as name,
  DEFAULT_CHARACTER_SET_NAME as characterSet,
  DEFAULT_COLLATION_NAME as collation
FROM INFORMATION_SCHEMA.SCHEMATA
WHERE SCHEMA_NAME = ?;

-- Table list
SELECT
  TABLE_NAME as name,
  TABLE_TYPE as type,
  ENGINE as engine,
  TABLE_ROWS as rowCount,
  DATA_LENGTH as dataLength,
  INDEX_LENGTH as indexLength,
  TABLE_COMMENT as comment
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = ?
ORDER BY TABLE_NAME;
```

#### 3. Table Resource (`mysql://{database}/{table}`)

**Purpose**: Get complete table schema with columns, indexes, and foreign keys

**Response Structure**:
```typescript
interface TableResource {
  table: {
    database: string;
    name: string;
    type: 'BASE TABLE' | 'VIEW';
    engine: string;
    rowFormat: string;
    rowCount: number;
    avgRowLength: number;
    dataLength: number;
    maxDataLength: number;
    indexLength: number;
    autoIncrement: number | null;
    createTime: string;
    updateTime: string | null;
    comment: string;
  };
  columns: Array<{
    name: string;
    ordinalPosition: number;
    dataType: string;
    columnType: string;  // Full type with length/precision
    isNullable: boolean;
    columnKey: 'PRI' | 'UNI' | 'MUL' | '';
    defaultValue: string | null;
    extra: string;  // auto_increment, on update, etc.
    comment: string;
    characterSet: string | null;
    collation: string | null;
  }>;
  indexes: Array<{
    name: string;
    unique: boolean;
    columns: string[];
    indexType: string;
    comment: string;
  }>;
  foreignKeys: Array<{
    name: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onUpdate: string;
    onDelete: string;
  }>;
}
```

**SQL Queries**:
```sql
-- Table info
SELECT
  TABLE_SCHEMA as database,
  TABLE_NAME as name,
  TABLE_TYPE as type,
  ENGINE as engine,
  ROW_FORMAT as rowFormat,
  TABLE_ROWS as rowCount,
  AVG_ROW_LENGTH as avgRowLength,
  DATA_LENGTH as dataLength,
  MAX_DATA_LENGTH as maxDataLength,
  INDEX_LENGTH as indexLength,
  AUTO_INCREMENT as autoIncrement,
  CREATE_TIME as createTime,
  UPDATE_TIME as updateTime,
  TABLE_COMMENT as comment
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?;

-- Columns
SELECT
  COLUMN_NAME as name,
  ORDINAL_POSITION as ordinalPosition,
  DATA_TYPE as dataType,
  COLUMN_TYPE as columnType,
  IS_NULLABLE = 'YES' as isNullable,
  COLUMN_KEY as columnKey,
  COLUMN_DEFAULT as defaultValue,
  EXTRA as extra,
  COLUMN_COMMENT as comment,
  CHARACTER_SET_NAME as characterSet,
  COLLATION_NAME as collation
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION;

-- Indexes
SELECT
  INDEX_NAME as name,
  NON_UNIQUE = 0 as unique,
  GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as columns,
  INDEX_TYPE as indexType,
  INDEX_COMMENT as comment
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE, INDEX_COMMENT;

-- Foreign Keys
SELECT
  CONSTRAINT_NAME as name,
  GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) as columns,
  REFERENCED_TABLE_NAME as referencedTable,
  GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) as referencedColumns,
  UPDATE_RULE as onUpdate,
  DELETE_RULE as onDelete
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
  AND REFERENCED_TABLE_NAME IS NOT NULL
GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE;
```

### Resource Discovery

The server implements `resources/list` to dynamically enumerate resources:

```typescript
async function listResources(): Promise<Resource[]> {
  const resources: Resource[] = [
    {
      uri: 'mysql://databases',
      name: 'All Databases',
      description: 'List all accessible databases',
      mimeType: 'application/json'
    }
  ];

  // Dynamically add database resources
  const databases = await getDatabases();
  for (const db of databases) {
    resources.push({
      uri: `mysql://${db.name}`,
      name: `Database: ${db.name}`,
      description: `Tables and metadata for ${db.name} database`,
      mimeType: 'application/json'
    });
  }

  // Note: Table resources are not pre-enumerated (too many)
  // They are discovered on-demand via URI pattern matching

  return resources;
}
```

---

## Tool Design

### `mysql_query` Tool

#### Tool Definition

```typescript
const QueryInputSchema = z.object({
  query: z.string()
    .min(1, "Query cannot be empty")
    .max(10000, "Query cannot exceed 10,000 characters")
    .describe("SQL query to execute. Must use fully qualified table names (database.table format)."),

  response_format: z.enum(['markdown', 'json'])
    .default('markdown')
    .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable")
}).strict();

type QueryInput = z.infer<typeof QueryInputSchema>;
```

#### Tool Description

```typescript
const toolDescription = `Execute a SQL query against the MySQL database.

This tool allows you to run SQL queries with full SQL expressiveness. The server operates in ${mode} mode.

**Query Requirements**:
- Must use fully qualified table names: database.table (e.g., "SELECT * FROM mydb.users")
- Do NOT use unqualified names like "SELECT * FROM users"

**${mode === 'READ-ONLY' ? 'READ-ONLY' : 'WRITE'} Mode Restrictions**:
${mode === 'READ-ONLY' ? `
- ALLOWED: SELECT, SHOW, DESCRIBE, EXPLAIN
- BLOCKED: INSERT, UPDATE, DELETE, REPLACE, CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE
- To enable write operations, set MYSQL_ALLOW_WRITE=true environment variable
` : `
- ALLOWED: SELECT, SHOW, DESCRIBE, EXPLAIN, INSERT, UPDATE, DELETE, REPLACE, transactions
- BLOCKED: DROP, TRUNCATE (dangerous DDL), GRANT, REVOKE (administrative)
- Dangerous DDL operations are blocked even in write mode for safety
`}

**Parameters**:
- query (required): SQL query string
  - Example: "SELECT * FROM ecommerce.orders WHERE status = 'pending' LIMIT 10"
  - Example: "SELECT u.name, COUNT(o.id) FROM shop.users u LEFT JOIN shop.orders o ON u.id = o.user_id GROUP BY u.id"
  ${mode === 'WRITE_ENABLED' ? `
  - Example: "INSERT INTO logs.events (event_type, message) VALUES ('info', 'User login')"
  - Example: "UPDATE shop.products SET stock = stock - 1 WHERE id = 123"
  ` : ''}

- response_format (optional): "markdown" (default) or "json"
  - markdown: Human-readable formatted output with tables
  - json: Structured data with columns, rows, and metadata

**Return Value**:
For JSON format:
{
  "columns": [{"name": "id", "type": "int"}, {"name": "name", "type": "varchar"}],
  "rows": [[1, "Alice"], [2, "Bob"]],
  "rowCount": 2,
  "executionTime": 45,
  "truncated": false
}

For Markdown format:
Formatted table with results, execution time, and row count.

**Usage Examples**:

1. List all tables in a database:
   SHOW TABLES FROM mydb;

2. Get table structure:
   DESCRIBE mydb.users;

3. Query with joins:
   SELECT u.name, o.total
   FROM shop.users u
   INNER JOIN shop.orders o ON u.id = o.user_id
   WHERE o.status = 'completed'
   LIMIT 20;

4. Aggregate data:
   SELECT category, COUNT(*) as count, AVG(price) as avg_price
   FROM products.items
   GROUP BY category
   ORDER BY count DESC;

${mode === 'WRITE_ENABLED' ? `
5. Insert data (WRITE mode only):
   INSERT INTO logs.audit (user_id, action, timestamp)
   VALUES (123, 'login', NOW());

6. Update data (WRITE mode only):
   UPDATE inventory.products
   SET quantity = quantity - 5
   WHERE sku = 'PROD-123';
` : ''}

**Error Handling**:
- "Query blocked: INSERT not allowed in READ-ONLY mode" - Write operation attempted in read-only mode
- "Table 'mydb.users' doesn't exist" - Invalid table name or database
- "Access denied for user" - Insufficient MySQL user permissions
- "Query execution timeout" - Query took longer than MYSQL_QUERY_TIMEOUT
- "Unqualified table name detected" - Must use database.table format

**Performance Tips**:
- Always use LIMIT clause for large result sets
- Add WHERE clauses to filter data
- Select only needed columns instead of SELECT *
- Use EXPLAIN to analyze query performance
- Results are truncated at 25,000 characters - use LIMIT to control size
`;
```

#### Tool Implementation

```typescript
server.registerTool(
  'mysql_query',
  {
    title: 'Execute MySQL Query',
    description: toolDescription,
    inputSchema: QueryInputSchema,
    annotations: {
      readOnlyHint: false,  // Can modify data in write mode
      destructiveHint: mode === OperationMode.WRITE_ENABLED,
      idempotentHint: false,  // Depends on query
      openWorldHint: true  // Interacts with external database
    }
  },
  async (params: QueryInput) => {
    try {
      // 1. Parse and validate query
      const parseResult = parseQuery(params.query, currentMode);

      if (!parseResult.allowed) {
        return {
          content: [{
            type: 'text',
            text: `Query blocked: ${parseResult.reason}\n\n${parseResult.suggestion || ''}`
          }]
        };
      }

      // 2. Execute query
      const startTime = Date.now();
      const result = await executeQuery(params.query);
      const executionTime = Date.now() - startTime;

      // 3. Format response
      const formatted = formatQueryResult(
        result,
        params.response_format,
        executionTime,
        parseResult.queryType
      );

      // 4. Apply truncation if needed
      const finalResponse = applyCharacterLimit(formatted);

      return {
        content: [{
          type: 'text',
          text: finalResponse
        }]
      };

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: handleQueryError(error)
        }]
      };
    }
  }
);
```

---

## Data Flow

### Query Execution Flow

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Client sends mysql_query tool call                        │
│    { query: "SELECT * FROM db.table LIMIT 10" }             │
└────────────────────────┬──────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. Zod schema validation                                     │
│    - Check query is non-empty string                         │
│    - Validate response_format enum                           │
│    - Apply .strict() validation                              │
└────────────────────────┬──────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. Query Parser                                              │
│    - Normalize query (remove comments, trim whitespace)      │
│    - Detect query type (SELECT, INSERT, etc.)               │
│    - Check if allowed in current mode                        │
│    - Return { allowed: boolean, reason?: string }           │
└────────────────────────┬──────────────────────────────────────┘
                         │
                   ┌─────┴─────┐
                   │           │
           allowed=false    allowed=true
                   │           │
                   ▼           ▼
    ┌──────────────────┐   ┌──────────────────────────────────┐
    │ Return error     │   │ 4. Acquire connection from pool  │
    │ with reason      │   └────────────┬──────────────────────┘
    └──────────────────┘                │
                                        ▼
                         ┌──────────────────────────────────────┐
                         │ 5. Execute query with timeout        │
                         │    - Start timer                     │
                         │    - Execute SQL via mysql2          │
                         │    - Measure execution time          │
                         └────────────┬──────────────────────────┘
                                      │
                               ┌──────┴──────┐
                               │             │
                           success        error
                               │             │
                               ▼             ▼
               ┌─────────────────────┐   ┌──────────────────┐
               │ 6. Format result    │   │ Handle SQL error │
               │    - JSON or MD     │   │  - MySQL errors  │
               │    - Add metadata   │   │  - Timeout       │
               └──────┬──────────────┘   │  - Permission    │
                      │                  └──────────────────┘
                      ▼
        ┌──────────────────────────────┐
        │ 7. Apply CHARACTER_LIMIT     │
        │    - Check length            │
        │    - Truncate if needed      │
        │    - Add truncation message  │
        └──────┬───────────────────────┘
               │
               ▼
        ┌──────────────────────────────┐
        │ 8. Return to client          │
        │    { content: [{ text }] }   │
        └──────────────────────────────┘
```

### Resource Access Flow

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Client requests resource                                  │
│    URI: mysql://mydb/users                                   │
└────────────────────────┬──────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. Parse URI pattern                                         │
│    - Extract database name: "mydb"                           │
│    - Extract table name: "users"                             │
│    - Validate format                                         │
└────────────────────────┬──────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. Metadata Service                                          │
│    - Query INFORMATION_SCHEMA.COLUMNS                        │
│    - Query INFORMATION_SCHEMA.STATISTICS                     │
│    - Query INFORMATION_SCHEMA.KEY_COLUMN_USAGE              │
│    - Combine results into TableResource                      │
└────────────────────────┬──────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. Format response                                           │
│    - Default to Markdown format                              │
│    - Include column definitions                              │
│    - Include indexes and foreign keys                        │
│    - Format as readable tables                               │
└────────────────────────┬──────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. Return resource content                                   │
│    { contents: [{ uri, mimeType, text }] }                  │
└──────────────────────────────────────────────────────────────┘
```

---

## Error Handling Strategy

### Error Categories

```typescript
enum ErrorCategory {
  VALIDATION_ERROR,    // Invalid input (Zod validation)
  QUERY_BLOCKED,       // Query not allowed in current mode
  SQL_SYNTAX_ERROR,    // Invalid SQL syntax
  PERMISSION_ERROR,    // MySQL user lacks permission
  CONNECTION_ERROR,    // Database connection failed
  TIMEOUT_ERROR,       // Query exceeded timeout
  RESOURCE_ERROR,      // Resource not found
  UNKNOWN_ERROR        // Unexpected error
}
```

### Error Handling Functions

```typescript
function handleQueryError(error: unknown): string {
  // Type guard for MySQL errors
  if (isMySQL2Error(error)) {
    return handleMySQLError(error);
  }

  // Type guard for Zod validation errors
  if (error instanceof z.ZodError) {
    return handleValidationError(error);
  }

  // Type guard for timeout errors
  if (isTimeoutError(error)) {
    return handleTimeoutError();
  }

  // Generic error
  return handleUnknownError(error);
}

function handleMySQLError(error: MySQL2Error): string {
  switch (error.code) {
    case 'ER_NO_SUCH_TABLE':
      return `Error: Table '${error.table}' does not exist.\n\n` +
             `Tip: Use SHOW TABLES FROM ${error.database} to see available tables.\n` +
             `Remember to use fully qualified names: database.table`;

    case 'ER_BAD_DB_ERROR':
      return `Error: Database '${error.database}' does not exist or is not accessible.\n\n` +
             `Tip: Use SHOW DATABASES to see available databases.`;

    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_TABLEACCESS_DENIED_ERROR':
      return `Error: Access denied. Your MySQL user doesn't have permission for this operation.\n\n` +
             `Required permission: ${error.sqlState}\n` +
             `Contact your database administrator to grant appropriate permissions.`;

    case 'ER_PARSE_ERROR':
      return `Error: SQL syntax error.\n\n` +
             `${error.message}\n\n` +
             `Tip: Check your query syntax and ensure table names are fully qualified (database.table).`;

    case 'ER_DUP_ENTRY':
      return `Error: Duplicate entry '${error.message}'.\n\n` +
             `Tip: This typically means you're trying to insert a row that violates a unique constraint.`;

    case 'ER_LOCK_WAIT_TIMEOUT':
      return `Error: Lock wait timeout exceeded.\n\n` +
             `The query waited too long for a table lock. Try again later or check for long-running queries.`;

    default:
      return `Error: MySQL error (${error.code}): ${error.message}`;
  }
}

function handleTimeoutError(): string {
  return `Error: Query execution timeout exceeded (${MYSQL_QUERY_TIMEOUT}ms).\n\n` +
         `Suggestions:\n` +
         `- Add a LIMIT clause to reduce result set size\n` +
         `- Add WHERE clauses to filter data more specifically\n` +
         `- Use indexes on filtered columns\n` +
         `- Increase MYSQL_QUERY_TIMEOUT environment variable if needed`;
}

function handleValidationError(error: z.ZodError): string {
  const issues = error.issues.map(issue =>
    `- ${issue.path.join('.')}: ${issue.message}`
  ).join('\n');

  return `Error: Invalid input parameters.\n\n${issues}`;
}
```

### Logging Strategy

```typescript
// Log to stderr (stdio transport requires stdout for protocol)
function logInfo(message: string): void {
  console.error(`[INFO] ${new Date().toISOString()} - ${message}`);
}

function logWarning(message: string): void {
  console.error(`[WARN] ${new Date().toISOString()} - ${message}`);
}

function logError(message: string, error?: unknown): void {
  console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
  if (error) {
    console.error(error);
  }
}

// Log query execution (audit trail)
function logQuery(query: string, mode: OperationMode, allowed: boolean): void {
  const status = allowed ? 'EXECUTED' : 'BLOCKED';
  logInfo(`Query ${status} [${mode}]: ${truncateForLog(query, 200)}`);
}
```

---

## Security Model

### Defense in Depth

The server implements multiple layers of security:

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Query Parsing                                       │
│ - Detect query type through SQL analysis                     │
│ - Block operations based on mode rules                       │
│ - Prevent bypass through normalization                       │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: MySQL User Permissions                             │
│ - Ultimate security boundary                                 │
│ - Database-level permission enforcement                      │
│ - Table-level and column-level permissions                   │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Connection Security                                │
│ - SSL/TLS encryption                                         │
│ - Certificate validation                                     │
│ - Secure credential storage (env vars only)                  │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Resource Limits                                    │
│ - Query timeout enforcement                                  │
│ - Connection pool limits                                     │
│ - Result set size truncation                                 │
└─────────────────────────────────────────────────────────────┘
```

### Threat Model

#### Threat 1: SQL Injection
**Risk**: LLM-generated queries could contain malicious SQL

**Mitigation**:
- LLMs write complete queries (no user input interpolation)
- No parameterized placeholders that could be manipulated
- Query parser validates query structure
- MySQL user permissions as ultimate boundary

#### Threat 2: Query Parser Bypass
**Risk**: Attacker crafts query to bypass parser detection

**Mitigation**:
- Normalize queries (strip comments, collapse whitespace)
- Case-insensitive keyword detection
- Handle multi-statement queries
- Block entire query if any statement is disallowed
- Default to blocking unknown query types

**Example bypass attempts**:
```sql
-- Attempt 1: Comment obfuscation
/* comment */ DELETE /* comment */ FROM table;
Result: Normalized to "DELETE FROM table" → Detected and blocked

-- Attempt 2: Case variation
DeLeTe FrOm table;
Result: Uppercase normalization → Detected and blocked

-- Attempt 3: Multi-statement injection
SELECT * FROM table; DROP TABLE table;
Result: Both statements parsed → DROP detected and blocked
```

#### Threat 3: Credential Exposure
**Risk**: Database credentials leaked through logs or errors

**Mitigation**:
- Credentials only from environment variables
- Never log passwords or connection strings
- Sanitize error messages to remove credentials
- Use stderr for all logging (not returned to client)

#### Threat 4: Dangerous DDL Operations
**Risk**: Accidental data loss through DROP, TRUNCATE

**Mitigation**:
- Block DROP DATABASE, DROP TABLE in all modes
- Block TRUNCATE in all modes
- Require MySQL CLI for destructive operations
- Clear error messages explaining the block

#### Threat 5: Privilege Escalation
**Risk**: Gain admin privileges through GRANT/REVOKE

**Mitigation**:
- Block all administrative commands (GRANT, REVOKE, FLUSH, etc.)
- No support for user management operations
- Rely on MySQL user permissions
- Clear error messages for admin operations

### Audit Logging

```typescript
interface AuditLog {
  timestamp: string;
  mode: OperationMode;
  queryType: QueryType;
  allowed: boolean;
  query: string;  // Truncated for log safety
  executionTime?: number;
  error?: string;
}

function auditQuery(log: AuditLog): void {
  const entry = {
    ...log,
    query: truncateForLog(log.query, 200)
  };

  // Log to stderr
  console.error(JSON.stringify(entry));

  // Future: Send to external audit system
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Foundation)

**Goal**: Set up project structure, connection pooling, configuration

**Tasks**:
1. Initialize project structure
   - Create directory layout
   - Set up package.json with dependencies
   - Configure tsconfig.json with strict mode
   - Create .env.example file

2. Implement configuration loading
   - Environment variable validation
   - Default value handling
   - SSL certificate path resolution
   - Log configuration on startup

3. Implement MySQL connection pool
   - Create MySQLClient service
   - Configure pool with timeouts and limits
   - Implement health check method
   - Handle connection errors

4. Set up logging infrastructure
   - Create logging utilities (logInfo, logError, etc.)
   - Configure stderr logging
   - Implement audit logging structure

**Deliverable**: Server can connect to MySQL database and log configuration

### Phase 2: Query Parser (Safety Foundation)

**Goal**: Implement robust SQL query parsing and validation

**Tasks**:
1. Implement query normalization
   - Comment removal (-- and /* */)
   - Whitespace collapsing
   - Statement splitting (semicolon handling)

2. Implement query type detection
   - Keyword mapping to QueryType enum
   - Handle CTEs (WITH clauses)
   - Handle subqueries

3. Implement validation rules
   - Define allowed operations per mode
   - Create validation logic
   - Generate clear error messages

4. Write parser tests
   - Test all query types
   - Test bypass attempts
   - Test edge cases (comments, multi-statement)

**Deliverable**: Query parser reliably detects and blocks inappropriate queries

### Phase 3: Query Tool Implementation

**Goal**: Implement `mysql_query` tool with full functionality

**Tasks**:
1. Define Zod schemas
   - QueryInputSchema with validation
   - Type inference for TypeScript

2. Implement query executor
   - Execute SQL via connection pool
   - Measure execution time
   - Handle timeouts
   - Return result metadata

3. Implement response formatters
   - JSON formatter with metadata
   - Markdown formatter with tables
   - Character limit truncation
   - Truncation messages

4. Implement error handlers
   - MySQL error translation
   - Timeout error handling
   - Validation error formatting

5. Register tool with MCP server
   - Complete tool description
   - Set proper annotations
   - Wire up all components

**Deliverable**: Working `mysql_query` tool that executes queries safely

### Phase 4: MCP Resources Implementation

**Goal**: Expose databases and tables as MCP resources

**Tasks**:
1. Implement metadata service
   - Query INFORMATION_SCHEMA for databases
   - Query INFORMATION_SCHEMA for tables
   - Query INFORMATION_SCHEMA for columns, indexes, FKs

2. Implement database resource
   - Register `mysql://{database}` pattern
   - Return database info + table list
   - Format as JSON and Markdown

3. Implement table resource
   - Register `mysql://{database}/{table}` pattern
   - Return complete table schema
   - Include columns, indexes, foreign keys
   - Format as JSON and Markdown

4. Implement resource discovery
   - Implement `resources/list` handler
   - Dynamically enumerate databases
   - Return resource metadata

**Deliverable**: Resources accessible via `mysql://` URIs with schema metadata

### Phase 5: Testing and Refinement

**Goal**: Comprehensive testing and documentation

**Tasks**:
1. Integration testing
   - Test against real MySQL database
   - Verify read-only mode blocking
   - Verify write mode operations
   - Test resource access

2. Error handling testing
   - Test all error scenarios
   - Verify error message quality
   - Test connection failures

3. Performance testing
   - Test with large result sets
   - Verify truncation logic
   - Test query timeouts
   - Test connection pool under load

4. Write comprehensive README
   - Installation instructions
   - Configuration guide
   - Usage examples
   - Security considerations
   - Troubleshooting guide

5. Create example evaluations
   - 10 complex, realistic questions
   - Cover read operations
   - Test schema discovery
   - Verify query construction

**Deliverable**: Production-ready server with complete documentation

### Phase 6: Polish and Release

**Goal**: Final refinements and public release

**Tasks**:
1. Code review and cleanup
   - Remove any dead code
   - Ensure consistent formatting
   - Verify no `any` types
   - Check for code duplication

2. Documentation polish
   - Review all error messages
   - Verify tool descriptions
   - Check SQL examples accuracy
   - Update README with final details

3. Build verification
   - Ensure `npm run build` works
   - Verify dist/index.js is executable
   - Test in clean environment

4. Release preparation
   - Version tagging
   - Changelog creation
   - License file
   - Contributing guidelines

**Deliverable**: Published MySQL MCP server ready for community use

---

## Appendix: Technical Decisions

### Why Single Query Tool Instead of Multiple Tools?

**Decision**: Provide one `mysql_query` tool instead of separate tools for SELECT, INSERT, UPDATE, etc.

**Rationale**:
1. **SQL is the natural language**: LLMs are already trained on SQL syntax
2. **More flexible**: LLMs can write any query they need without tool limitations
3. **Simpler API**: One tool to learn instead of many
4. **Less abstraction**: Direct SQL access is clearer than wrapped operations
5. **Better for complex queries**: Joins, subqueries, CTEs work naturally

**Trade-offs**:
- Requires robust query parsing (mitigated by multi-layer security)
- LLMs must know SQL (acceptable - widely known language)

### Why Fully Qualified Table Names?

**Decision**: Require `database.table` format in all queries

**Rationale**:
1. **Multi-database support**: Clear which database is being queried
2. **No implicit USE statements**: Avoid hidden state
3. **Explicit is better**: No ambiguity about table location
4. **Easier parsing**: No need to track current database context

**Trade-offs**:
- Slightly more verbose queries (acceptable for clarity)
- LLMs must know database structure (solved by resources)

### Why Query Parsing Instead of Prepared Statements?

**Decision**: Parse queries to detect type instead of requiring prepared statements with placeholders

**Rationale**:
1. **LLMs write complete queries**: No user input to parameterize
2. **Full SQL expressiveness**: No placeholder limitations
3. **Natural for LLMs**: SQL is a known language
4. **Simpler for users**: No parameter binding syntax

**Trade-offs**:
- Parser must be robust (mitigated by testing and normalization)
- MySQL user permissions still ultimate security boundary

### Why Resources AND Tools?

**Decision**: Provide both MCP resources and query tool

**Rationale**:
1. **Resources for discovery**: Efficient schema exploration without query tool
2. **Resources are stateless**: URI-based access is cacheable
3. **Tool for execution**: Flexible query execution with full SQL
4. **Complementary**: Resources tell you what's available, tool lets you query it

**Benefits**:
- LLMs can explore schema via resources first
- Then write informed queries using the tool
- Resources reduce tool calls for metadata

---

## Summary

This design provides a flexible, secure MySQL MCP server that:

1. **Empowers LLMs** with full SQL expressiveness through a single unified tool
2. **Ensures safety** through multi-layer query parsing and validation
3. **Enables discovery** via MCP resources for efficient schema exploration
4. **Maintains security** with read-only default and explicit write mode
5. **Follows best practices** for MCP, TypeScript, and MySQL integration

The implementation plan provides a clear path from foundation to production-ready release.
