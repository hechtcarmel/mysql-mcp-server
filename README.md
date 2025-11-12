# MySQL MCP Server

A Model Context Protocol (MCP) server that provides LLMs with flexible, safe access to MySQL databases. This server enables AI agents to explore database schemas via MCP resources, execute raw SQL queries with intelligent safety parsing, and optionally perform write operations when explicitly enabled.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@hechtcarmel/mysql-mcp-server.svg)](https://www.npmjs.com/package/@hechtcarmel/mysql-mcp-server)

## Table of Contents

- [Quick Start](#quick-start)
  - [Claude Code](#for-claude-code)
  - [Cursor](#for-cursor)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage with MCP Clients](#usage-with-mcp-clients)
- [Available Tools](#available-tools)
- [MCP Resources](#mcp-resources)
- [Operation Modes](#operation-modes)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)
- [Performance Tips](#performance-tips)
- [Documentation](#documentation)
- [Contributing](#contributing)

## Quick Start

### Step 1: Create Your .env File

Create a `.env` file with your MySQL credentials. You can place it anywhere, for example:
- `~/.config/mysql-mcp/.env` (recommended)
- Or in your project directory

```bash
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=your_username
MYSQL_PASSWORD=your_password
MYSQL_ALLOW_WRITE=false
```

### Step 2: Configure Your MCP Client

#### For Claude Code

Run this command in Claude Code:

```bash
claude mcp add mysql-mcp --env MYSQL_ENV_FILE=/absolute/path/to/.env -- npx -y @hechtcarmel/mysql-mcp-server
```

Replace `/absolute/path/to/.env` with the actual path to your .env file.

#### For Cursor

Configure `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mysql-mcp": {
      "command": "npx",
      "args": ["-y", "@hechtcarmel/mysql-mcp-server"],
      "env": {
        "MYSQL_ENV_FILE": "/absolute/path/to/.env"
      }
    }
  }
}
```

Replace `/absolute/path/to/.env` with the actual path to your .env file, then restart Cursor.

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
- Claude Desktop or another MCP client

### Install via npm (Recommended)

```bash
# Global installation
npm install -g @hechtcarmel/mysql-mcp-server

# Or with pnpm
pnpm add -g @hechtcarmel/mysql-mcp-server
```

### Install from Source (Development)

For development or contributing:

```bash
# Clone the repository
git clone https://github.com/hechtcarmel/mysql-mcp-server.git
cd mysql-mcp-server

# Install dependencies
pnpm install

# Build the project
pnpm run build

# (Optional) Create a .env file for local testing
cp .env.example .env
# Edit .env with your MySQL credentials
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

## Usage with MCP Clients

This server works with any MCP-compatible client. Below are configuration examples for various clients.

### Claude Code

Open MCP settings via **Command Palette → MCP: Edit User MCP Settings** and add:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@hechtcarmel/mysql-mcp-server"],
      "env": {
        "MYSQL_ENV_FILE": "/absolute/path/to/.env"
      }
    }
  }
}
```

Create your `.env` file:

```bash
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=your_username
MYSQL_PASSWORD=your_password
MYSQL_ALLOW_WRITE=false
```

### Cursor

Open MCP settings via **Settings → MCP Servers → Add Server** or edit directly:

**Config file location:**
- **macOS/Linux**: `~/.cursor/mcp.json`
- **Windows**: `%APPDATA%\Cursor\User\mcp.json`

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@hechtcarmel/mysql-mcp-server"],
      "env": {
        "MYSQL_ENV_FILE": "/absolute/path/to/.env"
      }
    }
  }
}
```

### Claude Desktop

**Config file location:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@hechtcarmel/mysql-mcp-server"],
      "env": {
        "MYSQL_ENV_FILE": "/absolute/path/to/.env"
      }
    }
  }
}
```

### Alternative: Using Inline Environment Variables

If you prefer not to use a `.env` file, you can specify credentials directly:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@hechtcarmel/mysql-mcp-server"],
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

**Note:** Using a `.env` file is recommended for better security.

### Global Installation (Alternative)

If you prefer to install globally instead of using npx:

```bash
npm install -g @hechtcarmel/mysql-mcp-server
```

Then use `mysql-mcp-server` as the command:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "mysql-mcp-server",
      "env": {
        "MYSQL_ENV_FILE": "/absolute/path/to/.env"
      }
    }
  }
}
```

### Development - Install from Source

If installed from source instead of npm:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/absolute/path/to/mysql-mcp-server/dist/index.js"],
      "env": {
        "MYSQL_ENV_FILE": "/absolute/path/to/.env"
      }
    }
  }
}
```

### Activation

After configuring:
1. **Save** the config file
2. **Restart Claude Desktop** completely (Quit and reopen)
3. The MySQL server will appear in Claude's available tools

### Verify Installation

In Claude Desktop, you can verify the server is running by asking:

```
"What databases are available?"
```

Claude should access the `mysql://databases` resource and list your databases.

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

### Setup Development Environment

```bash
# Install dependencies
pnpm install

# Development mode (auto-reload)
pnpm run dev

# Production build
pnpm run build

# Run linter
pnpm run lint

# Auto-fix linting issues
pnpm run lint:fix

# Format code
pnpm run format

# Check formatting
pnpm run format:check
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

## Documentation

### For Users
- **[README.md](README.md)** - Complete user documentation (this file)
- **[USAGE_GUIDE.md](USAGE_GUIDE.md)** - Quick start guide with common patterns
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and release notes

### For AI Agents
- **[CLAUDE.md](CLAUDE.md)** - Quick reference for Claude
- **[AGENTS.md](AGENTS.md)** - Comprehensive integration guide for all AI agents

### For Developers
- **[spec/](spec/)** - Technical specifications and design documents
- **[tmp/LOCAL_TESTING_GUIDE.md](tmp/LOCAL_TESTING_GUIDE.md)** - Local testing instructions
- **[tmp/PUBLISHING_TO_NPM.md](tmp/PUBLISHING_TO_NPM.md)** - npm publishing guide

## Contributing

Contributions are welcome! Please follow these steps:

1. **Fork the repository** and clone your fork
2. **Install dependencies**: `pnpm install`
3. **Create a feature branch**: `git checkout -b feature/your-feature`
4. **Make your changes** following the code style:
   - Follow TypeScript strict mode conventions
   - Run `pnpm run lint` and `pnpm run format` before committing
   - Add tests for new features when applicable
   - Update documentation for user-facing changes
5. **Test your changes**: `pnpm run build && pnpm run lint`
6. **Commit your changes**: Use clear, descriptive commit messages
7. **Push to your fork** and submit a pull request

Please follow MCP best practices and ensure all CI checks pass.

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Built with [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- Uses [mysql2](https://github.com/sidorares/node-mysql2) for MySQL connectivity
- Input validation with [zod](https://github.com/colinhacks/zod)
- Environment management with [dotenv](https://github.com/motdotla/dotenv)

## Support

For issues, questions, or contributions:
- **GitHub Issues**: [github.com/hechtcarmel/mysql-mcp-server/issues](https://github.com/hechtcarmel/mysql-mcp-server/issues)
- **Documentation**: See files listed above
- **MCP Protocol**: [modelcontextprotocol.io](https://modelcontextprotocol.io)

---

**⚠️ Security Warning**: Always use read-only MySQL users when possible. Enable write mode only when necessary and with appropriate safeguards in place.
