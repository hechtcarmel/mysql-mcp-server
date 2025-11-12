# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [Unreleased]

### Planned Features
- Query history tracking and logging
- Query optimization with EXPLAIN analysis
- Result caching for frequently accessed metadata
- Multiple connection profiles support
- Advanced security features (SSH tunneling, credential rotation)
- Monitoring and observability dashboard
- Query builder tool for complex queries
- Schema diff tool for tracking changes
- Data export to CSV/Excel formats
- Safe DDL mode for schema changes

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
