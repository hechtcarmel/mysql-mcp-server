# MySQL MCP Server

A Model Context Protocol (MCP) server that provides LLMs with flexible, safe access to MySQL databases. This server enables AI agents to explore database schemas via MCP resources, execute raw SQL queries with intelligent safety parsing, and optionally perform write operations when explicitly enabled.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **🔒 Secure by Default**: Read-only mode prevents accidental data modification
- **🔍 Schema Discovery**: MCP resources for efficient database and table exploration
- **💪 Full SQL Support**: Execute any SQL query with full expressiveness
- **🛡️ Intelligent Query Parsing**: Blocks dangerous operations through SQL analysis
- **📊 Multiple Response Formats**: JSON or Markdown output for flexibility
- **🔐 SSL/TLS Support**: Secure database connections with certificate validation
- **⚡ Connection Pooling**: Efficient connection management with configurable limits
- **🎯 Fully Qualified Names**: Explicit `database.table` format for multi-database support

## Installation

### Prerequisites

- Node.js 18 or higher
- MySQL 5.7 or higher (or MariaDB 10.3+)
- An MCP client (e.g., Claude Desktop)

### Setup

1. Clone or download this repository:
```bash
git clone <repository-url>
cd mysql-mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

5. Configure your MySQL connection in `.env`:
```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=your_username
MYSQL_PASSWORD=your_password
MYSQL_ALLOW_WRITE=false
```

## Configuration

### Required Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MYSQL_HOST` | Database host address | **(required)** |
| `MYSQL_USER` | Database username | **(required)** |
| `MYSQL_PASSWORD` | Database password | **(required)** |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MYSQL_PORT` | Database port | `3306` |
| `MYSQL_ALLOW_WRITE` | Enable write operations (`true` or `false`) | `false` |
| `MYSQL_POOL_SIZE` | Maximum connections in pool | `10` |
| `MYSQL_CONNECTION_TIMEOUT` | Connection timeout (ms) | `10000` |
| `MYSQL_QUERY_TIMEOUT` | Query execution timeout (ms) | `30000` |
| `MYSQL_DATABASE` | Default database (optional) | - |
| `MYSQL_ENV_FILE` | Path to custom .env file | - |

### SSL/TLS Configuration (Optional)

| Variable | Description |
|----------|-------------|
| `MYSQL_SSL_CA` | Path to SSL CA certificate |
| `MYSQL_SSL_CERT` | Path to SSL client certificate |
| `MYSQL_SSL_KEY` | Path to SSL client key |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | Reject unauthorized certificates (`true` or `false`, default: `true`) |

## Usage with Claude Desktop

Add the server to your Claude Desktop configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Read-Only Mode (Recommended)

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
        "MYSQL_PASSWORD": "your_password",
        "MYSQL_ALLOW_WRITE": "false"
      }
    }
  }
}
```

### Write Mode (Use with Caution)

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
        "MYSQL_PASSWORD": "your_password",
        "MYSQL_ALLOW_WRITE": "true"
      }
    }
  }
}
```

After configuring, restart Claude Desktop to load the server.

## Available Tools

### `mysql_query`

Execute SQL queries against the MySQL database.

**Parameters:**
- `query` (string, required): SQL query to execute using fully qualified table names
- `response_format` (enum, optional): `"markdown"` (default) or `"json"`

**Examples:**

```sql
-- List all tables in a database
SHOW TABLES FROM mydb;

-- Get table structure
DESCRIBE mydb.users;

-- Query with fully qualified names
SELECT * FROM shop.orders WHERE status = 'pending' LIMIT 10;

-- Join across tables
SELECT u.name, COUNT(o.id) as order_count
FROM shop.users u
LEFT JOIN shop.orders o ON u.id = o.user_id
GROUP BY u.id
LIMIT 20;
```

**Write Mode Examples** (when `MYSQL_ALLOW_WRITE=true`):

```sql
-- Insert data
INSERT INTO logs.events (event_type, message, created_at)
VALUES ('info', 'User login', NOW());

-- Update data
UPDATE shop.products
SET stock = stock - 1
WHERE id = 123;

-- Delete data
DELETE FROM cache.sessions
WHERE expires_at < NOW();
```

## MCP Resources

The server exposes databases and tables as MCP resources for efficient schema exploration:

### `mysql://databases`
List all accessible databases with character sets and table counts.

### `mysql://{database}`
Get database information and list of all tables with metadata.

### `mysql://{database}/{table}`
Get complete table schema including:
- Column definitions (name, type, nullable, default, comments)
- Indexes (name, columns, type, uniqueness)
- Foreign keys (relationships, cascade rules)
- Table statistics (row count, data size, engine)

## Operation Modes

### Read-Only Mode (Default)

**Allowed Operations:**
- `SELECT` - Query data
- `SHOW` - Show databases, tables, etc.
- `DESCRIBE` / `DESC` - Show table structure
- `EXPLAIN` - Analyze query execution

**Blocked Operations:**
- All write operations (INSERT, UPDATE, DELETE, REPLACE)
- DDL operations (CREATE, ALTER, DROP, TRUNCATE)
- Transaction control (START TRANSACTION, COMMIT, ROLLBACK)
- Administrative commands (GRANT, REVOKE, FLUSH, KILL)

### Write Mode

Enable by setting `MYSQL_ALLOW_WRITE=true`.

**Additionally Allowed:**
- `INSERT` - Insert new data
- `UPDATE` - Modify existing data
- `DELETE` - Remove data
- `REPLACE` - Replace existing data
- `START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` - Transaction control

**Still Blocked (for safety):**
- `DROP DATABASE`, `DROP TABLE` - Destructive DDL
- `TRUNCATE` - Delete all data
- `GRANT`, `REVOKE` - Permission management
- `FLUSH`, `KILL`, `LOAD DATA` - Administrative commands

## Security Considerations

### Defense in Depth

The server implements multiple security layers:

1. **Query Parsing**: SQL analysis blocks dangerous operations before execution
2. **MySQL Permissions**: Database user permissions provide ultimate security boundary
3. **SSL/TLS**: Encrypted connections protect data in transit
4. **Query Timeouts**: Prevent long-running queries from consuming resources
5. **Audit Logging**: All queries are logged to stderr for audit purposes

### Best Practices

- **Use read-only MySQL users** for read-only mode
- **Grant minimal permissions** to MySQL users (principle of least privilege)
- **Enable SSL/TLS** for production database connections
- **Monitor query logs** for suspicious activity
- **Use write mode sparingly** and only when necessary
- **Never expose credentials** in configuration files shared publicly

### Query Parser Security

The query parser is designed to be resilient against bypass attempts:

- Case-insensitive keyword detection
- Comment stripping (both `--` and `/* */` styles)
- Whitespace normalization
- Multi-statement query analysis
- Default-deny for unknown operations

## Troubleshooting

### Connection Issues

**Error: "Connection refused"**
- Verify MySQL server is running
- Check `MYSQL_HOST` and `MYSQL_PORT` are correct
- Ensure no firewall rules blocking the connection

**Error: "Access denied for user"**
- Verify `MYSQL_USER` and `MYSQL_PASSWORD` are correct
- Check user has appropriate permissions: `GRANT SELECT ON *.* TO 'user'@'host';`

### Query Issues

**Error: "Table 'database.table' doesn't exist"**
- Verify you're using fully qualified names (`database.table`)
- Use `SHOW TABLES FROM database` to see available tables
- Check user has permissions on the specific database

**Error: "Query blocked: INSERT not allowed in READ-ONLY mode"**
- Server is in read-only mode (default)
- Set `MYSQL_ALLOW_WRITE=true` to enable write operations

**Error: "Query execution timeout"**
- Query took longer than `MYSQL_QUERY_TIMEOUT` (default 30s)
- Add `LIMIT` clause to restrict result set size
- Add `WHERE` clauses for better filtering
- Optimize query or increase timeout

### Server Issues

**Server won't start**
- Check all required environment variables are set
- Verify MySQL credentials are correct
- Check server logs (stderr output) for specific errors

**Results are truncated**
- Responses are limited to 25,000 characters
- Use `LIMIT` clause to restrict row count
- Select specific columns instead of `SELECT *`
- Break large queries into smaller, focused queries

## Development

### Build from Source

```bash
# Install dependencies
npm install

# Development mode (auto-reload)
npm run dev

# Production build
npm run build

# Run built server
npm start
```

### Project Structure

```
mysql-mcp-server/
├── src/
│   ├── index.ts                 # Server entry point
│   ├── constants.ts             # Configuration constants
│   ├── types.ts                 # TypeScript type definitions
│   ├── services/
│   │   ├── config-loader.ts     # Environment variable loading
│   │   ├── mysql-client.ts      # Connection pool manager
│   │   ├── query-parser.ts      # SQL query parser
│   │   ├── query-executor.ts    # Query execution logic
│   │   └── metadata-service.ts  # Schema metadata retrieval
│   ├── schemas/
│   │   └── tool-schemas.ts      # Zod validation schemas
│   ├── tools/
│   │   └── query-tool.ts        # mysql_query tool
│   ├── resources/
│   │   ├── database-resource.ts # Database resources
│   │   └── table-resource.ts    # Table resources
│   └── utils/
│       ├── formatters.ts        # Response formatters
│       ├── error-handlers.ts    # Error handling
│       └── logger.ts            # Logging utilities
├── dist/                        # Compiled JavaScript
├── .env.example                 # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## Performance Tips

- **Use LIMIT**: Always add `LIMIT` clauses for exploratory queries
- **Filter with WHERE**: Add specific filters to reduce result set size
- **Select Specific Columns**: Avoid `SELECT *`, choose only needed columns
- **Use Indexes**: Ensure filtered columns have appropriate indexes
- **Analyze with EXPLAIN**: Use `EXPLAIN` to understand query execution plans
- **Monitor Timeouts**: Adjust `MYSQL_QUERY_TIMEOUT` if needed for complex queries

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Follow TypeScript strict mode conventions
2. Use consistent code formatting
3. Add tests for new features
4. Update documentation for changes
5. Follow MCP best practices

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Built with [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- Uses [mysql2](https://github.com/sidorares/node-mysql2) for MySQL connectivity
- Validation with [zod](https://github.com/colinhacks/zod)

## Support

For issues, questions, or contributions:
- Create an issue on GitHub
- Review the troubleshooting section
- Check MCP documentation at [modelcontextprotocol.io](https://modelcontextprotocol.io)

---

**⚠️ Security Warning**: Always use read-only MySQL users when possible. Enable write mode only when necessary and with appropriate safeguards in place.
