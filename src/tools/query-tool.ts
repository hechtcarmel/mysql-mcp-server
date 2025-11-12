/**
 * MySQL query tool implementation
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { QueryInputSchema } from '../schemas/tool-schemas.js';
import { QueryExecutor } from '../services/query-executor.js';
import { formatAsJSON, formatAsMarkdown, applyCharacterLimit } from '../utils/formatters.js';
import { handleQueryError } from '../utils/error-handlers.js';
import { OperationMode, QueryType } from '../types.js';

/**
 * Create comprehensive tool description for mysql_query
 */
function createToolDescription(mode: OperationMode): string {
  const modeLabel = mode === OperationMode.READ_ONLY ? 'READ-ONLY' : 'WRITE';

  return `Execute a SQL query against the MySQL database.

This tool allows you to run SQL queries with full SQL expressiveness. The server operates in ${modeLabel} mode.

**Query Requirements:**
- Must use fully qualified table names: database.table (e.g., "SELECT * FROM mydb.users")
- Do NOT use unqualified names like "SELECT * FROM users"
- Queries are case-insensitive but table/column names may be case-sensitive depending on OS

**${modeLabel} Mode Restrictions:**
${
  mode === OperationMode.READ_ONLY
    ? `
- ✅ ALLOWED: SELECT, SHOW, DESCRIBE, EXPLAIN
- ❌ BLOCKED: INSERT, UPDATE, DELETE, REPLACE, CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE
- To enable write operations, set MYSQL_ALLOW_WRITE=true environment variable
`
    : `
- ✅ ALLOWED: SELECT, SHOW, DESCRIBE, EXPLAIN, INSERT, UPDATE, DELETE, REPLACE, transactions
- ⚠️ ALLOWED WITH CAUTION: Transaction control (START TRANSACTION, COMMIT, ROLLBACK, SAVEPOINT)
- ❌ BLOCKED: DROP, TRUNCATE (dangerous DDL), GRANT, REVOKE (administrative commands)
- Dangerous DDL operations are blocked even in write mode for safety
`
}

**Parameters:**

1. **query** (required, string):
   - The SQL query to execute
   - Must use database.table format for all tables
   - Maximum length: 10,000 characters

   Examples:
   - \`SELECT * FROM ecommerce.orders WHERE status = 'pending' LIMIT 10\`
   - \`SELECT u.name, COUNT(o.id) as order_count FROM shop.users u LEFT JOIN shop.orders o ON u.id = o.user_id GROUP BY u.id LIMIT 20\`
   - \`SHOW TABLES FROM mydb\`
   - \`DESCRIBE mydb.users\`
   - \`EXPLAIN SELECT * FROM products.items WHERE category = 'electronics'\`
   ${
     mode === OperationMode.WRITE_ENABLED
       ? `
   - \`INSERT INTO logs.events (event_type, message, created_at) VALUES ('info', 'User login', NOW())\`
   - \`UPDATE shop.products SET stock = stock - 1 WHERE id = 123\`
   - \`DELETE FROM cache.sessions WHERE expires_at < NOW()\`
   `
       : ''
   }

2. **response_format** (optional, enum: "markdown" | "json", default: "markdown"):
   - **markdown**: Human-readable formatted output with tables, ideal for viewing
   - **json**: Structured data with columns, rows, and metadata, ideal for programmatic processing

**Return Value:**

For JSON format:
\`\`\`json
{
  "columns": [
    {"name": "id", "type": "LONG"},
    {"name": "name", "type": "VAR_STRING"}
  ],
  "rows": [
    [1, "Alice"],
    [2, "Bob"]
  ],
  "metadata": {
    "rowCount": 2,
    "executionTime": 45,
    "truncated": false
  }
}
\`\`\`

For Markdown format:
- SELECT queries: Formatted table with results, execution time, and row count
- INSERT/UPDATE/DELETE: Success message with affected rows and execution time
- SHOW/DESCRIBE: Formatted table with metadata

**Common Use Cases:**

1. **List all tables in a database:**
   \`SHOW TABLES FROM mydb\`

2. **Get table structure:**
   \`DESCRIBE mydb.users\`

3. **Query with joins:**
   \`SELECT u.name, o.total FROM shop.users u INNER JOIN shop.orders o ON u.id = o.user_id WHERE o.status = 'completed' LIMIT 20\`

4. **Aggregate data:**
   \`SELECT category, COUNT(*) as count, AVG(price) as avg_price FROM products.items GROUP BY category ORDER BY count DESC\`

5. **Analyze query performance:**
   \`EXPLAIN SELECT * FROM products.items WHERE category = 'electronics' AND price > 100\`

${
  mode === OperationMode.WRITE_ENABLED
    ? `
6. **Insert data (WRITE mode only):**
   \`INSERT INTO logs.audit (user_id, action, timestamp) VALUES (123, 'login', NOW())\`

7. **Update data (WRITE mode only):**
   \`UPDATE inventory.products SET quantity = quantity - 5 WHERE sku = 'PROD-123'\`

8. **Delete data (WRITE mode only):**
   \`DELETE FROM cache.temp_data WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)\`

9. **Transaction (WRITE mode only):**
   \`START TRANSACTION; UPDATE accounts.balance SET amount = amount - 100 WHERE id = 1; COMMIT;\`
`
    : ''
}

**Error Handling:**

Common errors and how to resolve them:

- **"Query blocked: INSERT not allowed in READ-ONLY mode"**
  → Write operation attempted in read-only mode. Set MYSQL_ALLOW_WRITE=true to enable.

- **"Table 'mydb.users' doesn't exist"**
  → Invalid table name or database. Use SHOW TABLES FROM database_name to see available tables.

- **"Access denied for user"**
  → Insufficient MySQL user permissions. Contact database administrator.

- **"Query execution timeout"**
  → Query took too long. Add LIMIT clause, WHERE filters, or optimize query.

- **"Unqualified table name detected"**
  → Must use database.table format (e.g., mydb.users, not just users).

**Performance Tips:**

- Always use LIMIT clause for exploratory queries to avoid large result sets
- Add WHERE clauses to filter data specifically
- Select only needed columns instead of SELECT *
- Use EXPLAIN to analyze query performance
- Results are automatically truncated at 25,000 characters
- For large datasets, use pagination with LIMIT and OFFSET

**Security Notes:**

- Queries are parsed and validated before execution
- Dangerous operations (DROP, TRUNCATE) are always blocked
- Administrative commands (GRANT, REVOKE) are never allowed
- MySQL user permissions provide ultimate security boundary
- All queries are logged for audit purposes`;
}

/**
 * Create the mysql_query tool
 */
export function createQueryTool(
  _queryExecutor: QueryExecutor,
  operationMode: OperationMode,
  _queryTimeout: number
): Tool {
  return {
    name: 'mysql_query',
    description: createToolDescription(operationMode),
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: QueryInputSchema.shape.query.description
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: QueryInputSchema.shape.response_format.description,
          default: 'markdown'
        }
      },
      required: ['query']
    }
  };
}

/**
 * Handle mysql_query tool call
 */
export async function handleQueryTool(
  args: unknown,
  executor: QueryExecutor,
  timeout: number
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    // Validate input with Zod
    const input = QueryInputSchema.parse(args);

    // Execute query
    const result = await executor.executeQuery(input.query);

    // Format result based on requested format
    let formatted: string;
    if (input.response_format === 'json') {
      formatted = formatAsJSON(result);
    } else {
      // Markdown is default
      formatted = formatAsMarkdown(result, result.columns ? QueryType.SELECT : QueryType.INSERT);
    }

    // Apply character limit truncation
    const finalResponse = applyCharacterLimit(formatted, true);

    return {
      content: [
        {
          type: 'text',
          text: finalResponse
        }
      ]
    };
  } catch (error) {
    // Handle all errors with appropriate error messages
    const errorMessage = handleQueryError(error, timeout);

    return {
      content: [
        {
          type: 'text',
          text: errorMessage
        }
      ]
    };
  }
}
