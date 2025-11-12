# MySQL MCP Server - Agent Integration Guide

This document provides comprehensive information for AI agents, assistants, and developers integrating with the MySQL MCP Server.

## Quick Reference

- **Server Name**: `mysql-mcp-server`
- **Package**: `@hechtcarmel/mysql-mcp-server`
- **Protocol**: Model Context Protocol (MCP)
- **Purpose**: Secure, flexible MySQL database access for AI agents
- **Default Mode**: Read-only (secure by default)

## Available Tools

### `mysql_query`

Execute SQL queries against MySQL databases with intelligent safety parsing.

**Input Schema:**
```typescript
{
  query: string;           // SQL query (required, max 10,000 chars)
  response_format?: 'markdown' | 'json';  // Output format (default: 'markdown')
}
```

**Important Requirements:**
- **Always use fully qualified table names**: `database.table` format
- Example: `SELECT * FROM shop.orders LIMIT 10` ✅
- Not: `SELECT * FROM orders` ❌

**Response Format:**

*Markdown (default):*
- Human-readable tables
- Execution time and row counts
- Truncation warnings with suggestions

*JSON:*
```json
{
  "columns": [{"name": "id", "type": "LONG"}, ...],
  "rows": [[1, "data"], ...],
  "metadata": {
    "rowCount": 10,
    "executionTime": 45,
    "truncated": false
  }
}
```

**Operation Modes:**

**READ-ONLY (Default):**
- ✅ Allowed: SELECT, SHOW, DESCRIBE, EXPLAIN
- ❌ Blocked: INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE

**WRITE (when MYSQL_ALLOW_WRITE=true):**
- ✅ Allowed: SELECT, SHOW, DESCRIBE, EXPLAIN, INSERT, UPDATE, DELETE, REPLACE, Transactions
- ❌ Still Blocked: DROP, TRUNCATE, GRANT, REVOKE (dangerous operations)

## Available Resources

Resources provide efficient, read-only access to database schema metadata without executing queries.

### `mysql://databases`
List all accessible databases with metadata.

**Returns:**
- Database names
- Character sets and collations
- Table counts per database

### `mysql://{database}`
Get information about a specific database.

**Returns:**
- Database metadata (charset, collation)
- Complete list of tables
- Table statistics (rows, size, engine)

### `mysql://{database}/{table}`
Get complete schema for a specific table.

**Returns:**
- Column definitions (name, type, nullable, defaults, comments)
- Indexes (name, columns, type, uniqueness)
- Foreign keys (relationships, cascade rules)
- Table statistics (row count, data size, auto_increment)

## Common Patterns

### 1. Schema Discovery Workflow

```
Step 1: List all databases
→ Use resource: mysql://databases

Step 2: Explore a specific database
→ Use resource: mysql://shop

Step 3: Get table schema
→ Use resource: mysql://shop/orders

Step 4: Query the data
→ Use tool: mysql_query with "SELECT * FROM shop.orders LIMIT 10"
```

### 2. Data Analysis Workflow

```
Step 1: Understand table structure
→ Use resource: mysql://analytics/events

Step 2: Count records
→ Query: "SELECT COUNT(*) FROM analytics.events WHERE date >= CURDATE()"

Step 3: Aggregate data
→ Query: "SELECT event_type, COUNT(*) as count FROM analytics.events
         GROUP BY event_type ORDER BY count DESC LIMIT 10"
```

### 3. Data Modification Workflow (Write Mode Only)

```
Step 1: Verify current state
→ Query: "SELECT * FROM shop.products WHERE id = 123"

Step 2: Make the change
→ Query: "UPDATE shop.products SET stock = stock - 5 WHERE id = 123"

Step 3: Verify the change
→ Query: "SELECT * FROM shop.products WHERE id = 123"
```

## Best Practices for AI Agents

### 1. Always Use Fully Qualified Names

❌ Wrong:
```sql
SELECT * FROM users;
```

✅ Correct:
```sql
SELECT * FROM mydb.users;
```

### 2. Use LIMIT Clauses

Always add LIMIT to exploratory queries to avoid overwhelming responses:

```sql
SELECT * FROM shop.orders ORDER BY created_at DESC LIMIT 100;
```

### 3. Leverage Resources Before Queries

Before querying data, use resources to understand the schema:

```
1. Check mysql://shop/orders resource
2. See available columns and types
3. Craft appropriate SQL query
```

### 4. Handle Truncation Gracefully

If results are truncated (> 25,000 characters):
- Add more specific WHERE filters
- Reduce LIMIT clause
- Select only needed columns instead of SELECT *

### 5. Provide Context in Errors

When queries fail, use error messages to guide next steps:
- Table not found → Use resources to find correct table name
- Permission denied → Check database accessibility
- Syntax error → Review fully qualified name requirements

## Error Handling Guide

### Common Errors and Solutions

**"Table 'database.table' doesn't exist"**
- Solution: Use `mysql://{database}` resource to see available tables
- Verify spelling and case sensitivity

**"Query blocked: INSERT not allowed in READ-ONLY mode"**
- Explanation: Server is in default read-only mode
- Solution: This is intentional for safety. Write operations require explicit enablement.

**"Unqualified table name detected"**
- Solution: Always use `database.table` format
- Example: Change `users` to `mydb.users`

**"Query execution timeout"**
- Solution: Optimize query with:
  - LIMIT clause
  - WHERE filters
  - Specific column selection
  - Proper indexes

**"Access denied for user"**
- Explanation: MySQL user permissions issue
- Solution: This is a database administrator issue, not a server issue

## Query Construction Tips

### 1. Use WHERE Clauses for Filtering

Instead of:
```sql
SELECT * FROM shop.orders;
```

Use:
```sql
SELECT * FROM shop.orders WHERE status = 'pending' AND created_at >= CURDATE();
```

### 2. Select Specific Columns

Instead of:
```sql
SELECT * FROM shop.products LIMIT 100;
```

Use:
```sql
SELECT id, name, price, stock FROM shop.products LIMIT 100;
```

### 3. Use Aggregation for Summaries

For counts and statistics:
```sql
SELECT
  status,
  COUNT(*) as count,
  AVG(total) as avg_total
FROM shop.orders
GROUP BY status
ORDER BY count DESC;
```

### 4. Join Tables Properly

Always use fully qualified names in JOINs:
```sql
SELECT
  u.name,
  COUNT(o.id) as order_count
FROM shop.users u
LEFT JOIN shop.orders o ON u.id = o.user_id
GROUP BY u.id, u.name
LIMIT 20;
```

## Security Considerations

### What AI Agents Should Know

1. **Read-only is default**: The server starts in read-only mode for safety
2. **Query parsing**: All queries are analyzed before execution
3. **Dangerous operations blocked**: DROP, TRUNCATE, GRANT always blocked
4. **MySQL permissions**: Database user permissions are the ultimate security boundary
5. **Audit logging**: All queries are logged for review

### Safe Practices

- **Prefer resources over queries** for schema information
- **Use SELECT before UPDATE/DELETE** to verify what will be changed
- **Add WHERE clauses** to prevent accidental bulk operations
- **Test with LIMIT 1** before running on full dataset

## Response Size Management

### Character Limit

Responses are limited to 25,000 characters. When truncated:

**Strategies to reduce size:**
1. Add stricter LIMIT clause (e.g., `LIMIT 50` instead of `LIMIT 500`)
2. Add WHERE filters to reduce rows
3. Select fewer columns (specific columns vs SELECT *)
4. Break query into multiple smaller queries

### Pagination Pattern

For large datasets:
```sql
-- First page
SELECT * FROM shop.orders ORDER BY id LIMIT 100 OFFSET 0;

-- Second page
SELECT * FROM shop.orders ORDER BY id LIMIT 100 OFFSET 100;

-- Third page
SELECT * FROM shop.orders ORDER BY id LIMIT 100 OFFSET 200;
```

## Integration Examples

### Example 1: Database Exploration

```markdown
User: "What databases are available?"

Agent:
1. Access resource: mysql://databases
2. Parse response to extract database names
3. Present formatted list to user
```

### Example 2: Data Query

```markdown
User: "Show me recent orders from the shop"

Agent:
1. Access resource: mysql://shop to verify 'orders' table exists
2. Access resource: mysql://shop/orders to understand schema
3. Execute query: "SELECT * FROM shop.orders ORDER BY created_at DESC LIMIT 10"
4. Format results for user
```

### Example 3: Data Analysis

```markdown
User: "What are the top-selling products?"

Agent:
1. Access resource: mysql://shop/order_items to understand structure
2. Execute query:
   "SELECT product_id, SUM(quantity) as total_sold
    FROM shop.order_items
    GROUP BY product_id
    ORDER BY total_sold DESC
    LIMIT 10"
3. Present analysis to user
```

## Troubleshooting for Agents

### Query Not Working?

**Checklist:**
- [ ] Using fully qualified names (database.table)?
- [ ] Added LIMIT clause for large datasets?
- [ ] Checked table exists via resources?
- [ ] SQL syntax is correct?
- [ ] Using allowed operations for current mode?

### Resource Not Found?

**Checklist:**
- [ ] Database name spelled correctly?
- [ ] Table name spelled correctly?
- [ ] Case sensitivity (check original names in mysql://databases)?
- [ ] User has permissions to access this database?

### Results Truncated?

**Actions:**
- Reduce LIMIT clause
- Add WHERE filters
- Select specific columns
- Use aggregation instead of raw data

## Advanced Features

### Transaction Support (Write Mode Only)

```sql
START TRANSACTION;
UPDATE shop.products SET stock = stock - 1 WHERE id = 123;
UPDATE shop.orders SET status = 'processing' WHERE id = 456;
COMMIT;
```

### Subqueries

```sql
SELECT * FROM shop.orders
WHERE user_id IN (
  SELECT id FROM shop.users WHERE status = 'premium'
)
LIMIT 100;
```

### Common Table Expressions (CTEs)

```sql
WITH recent_orders AS (
  SELECT * FROM shop.orders
  WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
)
SELECT status, COUNT(*) as count
FROM recent_orders
GROUP BY status;
```

## Performance Tips

1. **Use indexes**: Filtered columns should have indexes
2. **Avoid SELECT ***: Select only needed columns
3. **Add LIMIT**: Always limit result sets
4. **Use WHERE**: Filter early, don't filter in application
5. **Check EXPLAIN**: Use EXPLAIN to analyze query performance

## Support and Documentation

- **Full README**: See [README.md](README.md)
- **Quick Start**: See [USAGE_GUIDE.md](USAGE_GUIDE.md)
- **Specifications**: See `spec/` directory
- **Error Guide**: See [README.md#troubleshooting](README.md#troubleshooting)

---

**This document is maintained as the definitive guide for AI agents integrating with the MySQL MCP Server.**
