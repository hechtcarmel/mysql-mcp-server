# MySQL MCP Server - Quick Usage Guide

## Quick Start

### 1. Configure Environment

Create a `.env` file in the project root:

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=your_username
MYSQL_PASSWORD=your_password
MYSQL_ALLOW_WRITE=false
```

### 2. Build and Test

```bash
npm install
npm run build
```

### 3. Add to Claude Desktop

Edit your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/absolute/path/to/mysql-mcp-server/dist/index.js"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "your_username",
        "MYSQL_PASSWORD": "your_password"
      }
    }
  }
}
```

### 4. Restart Claude Desktop

The MySQL MCP Server will now be available in Claude.

## Common Usage Patterns

### Schema Exploration

```
"What databases are available?"
→ Uses mysql://databases resource

"Show me the structure of the users table in the mydb database"
→ Uses mysql://mydb/users resource

"List all tables in the shop database"
→ Uses mysql://shop resource
```

### Querying Data

```
"Show me the 10 most recent orders from shop.orders"
→ Executes: SELECT * FROM shop.orders ORDER BY created_at DESC LIMIT 10

"How many active users are there in mydb.users?"
→ Executes: SELECT COUNT(*) FROM mydb.users WHERE status = 'active'

"Get all products with low stock"
→ Executes: SELECT * FROM shop.products WHERE stock < 10
```

### Data Analysis

```
"What's the total revenue per category from sales.transactions?"
→ Executes: SELECT category, SUM(amount) as total FROM sales.transactions GROUP BY category

"Show me the top 5 customers by order count"
→ Executes: SELECT customer_id, COUNT(*) as orders FROM shop.orders GROUP BY customer_id ORDER BY orders DESC LIMIT 5
```

### Write Operations (when MYSQL_ALLOW_WRITE=true)

```
"Add a new user to mydb.users with name 'John Doe' and email 'john@example.com'"
→ Executes: INSERT INTO mydb.users (name, email, created_at) VALUES ('John Doe', 'john@example.com', NOW())

"Update the stock for product ID 123 to 50"
→ Executes: UPDATE shop.products SET stock = 50 WHERE id = 123

"Delete expired sessions from cache.sessions"
→ Executes: DELETE FROM cache.sessions WHERE expires_at < NOW()
```

## Important Reminders

### Always Use Fully Qualified Names

❌ **Wrong**: `SELECT * FROM users`
✅ **Correct**: `SELECT * FROM mydb.users`

### Start with Read-Only Mode

Default configuration has `MYSQL_ALLOW_WRITE=false`. This is the safe default.

### Use LIMIT Clauses

Always add LIMIT to exploratory queries:
```sql
SELECT * FROM shop.orders LIMIT 100
```

### Security Best Practices

1. **Read-Only MySQL Users**: Create dedicated read-only users for the MCP server
   ```sql
   CREATE USER 'mcp_readonly'@'localhost' IDENTIFIED BY 'password';
   GRANT SELECT ON *.* TO 'mcp_readonly'@'localhost';
   ```

2. **Limited Permission Users**: Grant only necessary permissions
   ```sql
   GRANT SELECT, INSERT, UPDATE ON mydb.* TO 'mcp_user'@'localhost';
   ```

3. **Never Use Root**: Don't use root or admin accounts with the MCP server

## Troubleshooting

### Server Won't Connect

Check the logs in Claude Desktop:
- **macOS**: `~/Library/Logs/Claude/mcp*.log`
- **Windows**: `%APPDATA%\Claude\Logs\mcp*.log`

Common issues:
- Wrong credentials (MYSQL_USER/MYSQL_PASSWORD)
- MySQL server not running
- Firewall blocking connection
- Wrong host or port

### Query Blocked

If you see "Query blocked" errors:
- Server is in read-only mode (default)
- Set `MYSQL_ALLOW_WRITE=true` for write operations
- Some operations (DROP, TRUNCATE) are always blocked

### Results Truncated

If results are cut off:
- Responses limited to 25,000 characters
- Add LIMIT clause: `LIMIT 100`
- Select specific columns instead of `SELECT *`
- Use WHERE clauses to filter data

## Operation Mode Reference

### Read-Only Mode (Default)
```
✅ Allowed: SELECT, SHOW, DESCRIBE, EXPLAIN
❌ Blocked: INSERT, UPDATE, DELETE, CREATE, ALTER, DROP
```

### Write Mode (MYSQL_ALLOW_WRITE=true)
```
✅ Allowed: SELECT, SHOW, DESCRIBE, EXPLAIN, INSERT, UPDATE, DELETE, REPLACE, Transactions
❌ Blocked: DROP, TRUNCATE, GRANT, REVOKE (always blocked for safety)
```

## Response Formats

### Markdown (Default)
Human-readable tables and formatted output. Best for viewing in Claude.

### JSON
Structured data with metadata. Request with:
```
"Show me users in JSON format"
→ Tool will use response_format: "json"
```

## Advanced Features

### SSL/TLS Connections

Add to your .env:
```env
MYSQL_SSL_CA=/path/to/ca.pem
MYSQL_SSL_CERT=/path/to/client-cert.pem
MYSQL_SSL_KEY=/path/to/client-key.pem
MYSQL_SSL_REJECT_UNAUTHORIZED=true
```

### Connection Pooling

Adjust pool size and timeouts:
```env
MYSQL_POOL_SIZE=20
MYSQL_CONNECTION_TIMEOUT=15000
MYSQL_QUERY_TIMEOUT=60000
```

### Custom .env Location

```env
MYSQL_ENV_FILE=/path/to/custom/.env
```

## Performance Tips

1. **Use Indexes**: Ensure filtered columns have indexes
2. **Add LIMIT**: Always use LIMIT for exploratory queries
3. **Filter Early**: Use WHERE clauses to reduce data
4. **Select Specific Columns**: Don't use `SELECT *` unnecessarily
5. **Use EXPLAIN**: Analyze query performance with EXPLAIN

## Support

For issues or questions:
- Check the [README.md](README.md) for detailed documentation
- Review the [CHANGELOG.md](CHANGELOG.md) for version history
- Check troubleshooting section above
- Review Claude Desktop logs for error details

---

**Happy Querying! 🚀**
