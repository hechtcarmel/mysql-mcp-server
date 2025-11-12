/**
 * Application constants for MySQL MCP Server
 */

/**
 * Maximum character limit for responses (25,000 characters)
 * Responses exceeding this limit will be truncated with a warning message
 */
export const CHARACTER_LIMIT = 25000;

/**
 * Default MySQL port
 */
export const DEFAULT_PORT = 3306;

/**
 * Default connection pool size
 */
export const DEFAULT_POOL_SIZE = 10;

/**
 * Default connection timeout in milliseconds (10 seconds)
 */
export const DEFAULT_CONNECTION_TIMEOUT = 10000;

/**
 * Default query execution timeout in milliseconds (30 seconds)
 */
export const DEFAULT_QUERY_TIMEOUT = 30000;

/**
 * System databases to exclude from listing
 */
export const SYSTEM_DATABASES = ['information_schema', 'performance_schema', 'mysql', 'sys'];

/**
 * Maximum query length in characters
 */
export const MAX_QUERY_LENGTH = 10000;

/**
 * Maximum length for truncated query in logs
 */
export const LOG_QUERY_TRUNCATE_LENGTH = 200;
