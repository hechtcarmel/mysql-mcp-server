/**
 * SQL Query Parser and Validator
 * Parses SQL queries to detect operation type and validates against operation mode
 */

import { QueryType, OperationMode, ParseResult } from '../types.js';
import { logQuery } from '../utils/logger.js';

/**
 * Operations that are always allowed (read-only)
 */
const ALWAYS_ALLOWED: QueryType[] = [QueryType.SELECT, QueryType.SHOW, QueryType.DESCRIBE, QueryType.EXPLAIN];

/**
 * Operations that are never allowed (dangerous/administrative)
 */
const NEVER_ALLOWED: QueryType[] = [
  QueryType.DROP,
  QueryType.TRUNCATE,
  QueryType.GRANT,
  QueryType.REVOKE,
  QueryType.FLUSH,
  QueryType.KILL,
  QueryType.LOAD_DATA
];

/**
 * Operations allowed only in write mode
 */
const WRITE_MODE_ALLOWED: QueryType[] = [
  QueryType.INSERT,
  QueryType.UPDATE,
  QueryType.DELETE,
  QueryType.REPLACE,
  QueryType.START_TRANSACTION,
  QueryType.COMMIT,
  QueryType.ROLLBACK,
  QueryType.SAVEPOINT
];

/**
 * Remove SQL comments from query
 */
function removeComments(query: string): string {
  // Remove single-line comments (-- to end of line)
  let result = query.replace(/--[^\n]*/g, '');

  // Remove multi-line comments (/* ... */)
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');

  return result;
}

/**
 * Normalize whitespace in query
 */
function normalizeWhitespace(query: string): string {
  // Trim leading/trailing whitespace
  let result = query.trim();

  // Collapse multiple spaces to single space
  result = result.replace(/\s+/g, ' ');

  return result;
}

/**
 * Normalize query by removing comments and normalizing whitespace
 */
function normalizeQuery(query: string): string {
  let normalized = removeComments(query);
  normalized = normalizeWhitespace(normalized);
  return normalized;
}

/**
 * Split query into individual statements
 */
function splitStatements(query: string): string[] {
  // Simple split on semicolons (not handling strings/comments for now)
  const statements = query
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0);

  return statements;
}

/**
 * Extract the first keyword from a statement
 */
function extractFirstKeyword(statement: string): string {
  const upper = statement.toUpperCase();

  // Handle WITH clauses (CTEs)
  if (upper.startsWith('WITH')) {
    const match = upper.match(/\bWITH\b[\s\S]*?\b(SELECT|INSERT|UPDATE|DELETE)\b/);
    if (match) {
      return match[1];
    }
  }

  // Extract first word
  const words = upper.split(/\s+/);
  return words[0] || '';
}

/**
 * Detect query type from SQL statement
 */
function detectQueryType(statement: string): QueryType {
  const keyword = extractFirstKeyword(statement);

  switch (keyword) {
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
    case 'BEGIN':
      return QueryType.START_TRANSACTION;
    case 'COMMIT':
      return QueryType.COMMIT;
    case 'ROLLBACK':
      return QueryType.ROLLBACK;
    case 'SAVEPOINT':
      return QueryType.SAVEPOINT;
    case 'GRANT':
      return QueryType.GRANT;
    case 'REVOKE':
      return QueryType.REVOKE;
    case 'FLUSH':
      return QueryType.FLUSH;
    case 'KILL':
      return QueryType.KILL;
    case 'LOAD':
      return QueryType.LOAD_DATA;
    case 'SHOW':
      return QueryType.SHOW;
    case 'DESCRIBE':
    case 'DESC':
      return QueryType.DESCRIBE;
    case 'EXPLAIN':
      return QueryType.EXPLAIN;
    case 'USE':
      return QueryType.USE;
    case 'SET':
      return QueryType.SET;
    default:
      return QueryType.UNKNOWN;
  }
}

/**
 * Check if a query type is allowed in the current operation mode
 */
function isAllowed(queryType: QueryType, mode: OperationMode): boolean {
  // Always allowed operations
  if (ALWAYS_ALLOWED.includes(queryType)) {
    return true;
  }

  // Never allowed operations
  if (NEVER_ALLOWED.includes(queryType)) {
    return false;
  }

  // Operations allowed only in write mode
  if (mode === OperationMode.WRITE_ENABLED && WRITE_MODE_ALLOWED.includes(queryType)) {
    return true;
  }

  // Default: block unknown operations
  return false;
}

/**
 * Generate explanation for why a query was blocked
 */
function explainBlocked(queryType: QueryType, mode: OperationMode): string {
  if (mode === OperationMode.READ_ONLY) {
    switch (queryType) {
      case QueryType.INSERT:
      case QueryType.UPDATE:
      case QueryType.DELETE:
      case QueryType.REPLACE:
        return `${queryType} operations are not allowed in READ-ONLY mode. Set MYSQL_ALLOW_WRITE=true to enable write operations.`;

      case QueryType.START_TRANSACTION:
      case QueryType.COMMIT:
      case QueryType.ROLLBACK:
      case QueryType.SAVEPOINT:
        return `Transaction control (${queryType}) is not allowed in READ-ONLY mode. Set MYSQL_ALLOW_WRITE=true to enable transactions.`;

      case QueryType.DROP:
      case QueryType.TRUNCATE:
        return `${queryType} operations are dangerous and never allowed for safety. Use MySQL CLI directly for destructive DDL operations.`;

      case QueryType.CREATE:
      case QueryType.ALTER:
        return `DDL operations (${queryType}) are not allowed in READ-ONLY mode.`;

      case QueryType.GRANT:
      case QueryType.REVOKE:
      case QueryType.FLUSH:
      case QueryType.KILL:
      case QueryType.LOAD_DATA:
        return `Administrative commands (${queryType}) are never allowed for security reasons.`;

      case QueryType.SET:
        return `SET operations are not allowed in READ-ONLY mode.`;

      default:
        return `${queryType} operations are not allowed in READ-ONLY mode.`;
    }
  } else {
    // Write mode
    switch (queryType) {
      case QueryType.DROP:
      case QueryType.TRUNCATE:
        return `${queryType} operations are dangerous and blocked even in WRITE mode for safety. Use MySQL CLI directly for destructive DDL operations.`;

      case QueryType.GRANT:
      case QueryType.REVOKE:
      case QueryType.FLUSH:
      case QueryType.KILL:
      case QueryType.LOAD_DATA:
        return `Administrative commands (${queryType}) are never allowed for security reasons.`;

      case QueryType.CREATE:
      case QueryType.ALTER:
        return `DDL operations (${queryType}) are not allowed even in WRITE mode. Use MySQL CLI for schema changes.`;

      default:
        return `${queryType} operations are not recognized or not allowed.`;
    }
  }
}

/**
 * Generate suggestion for fixing blocked query
 */
function suggestFix(queryType: QueryType, mode: OperationMode): string {
  if (mode === OperationMode.READ_ONLY) {
    if (WRITE_MODE_ALLOWED.includes(queryType)) {
      return 'To enable write operations, set the environment variable: MYSQL_ALLOW_WRITE=true';
    }

    if (queryType === QueryType.DROP || queryType === QueryType.TRUNCATE) {
      return 'For safety, destructive DDL operations must be performed directly using MySQL CLI, not through this MCP server.';
    }

    if (NEVER_ALLOWED.includes(queryType)) {
      return 'Administrative commands are never allowed through this MCP server for security reasons.';
    }
  } else {
    if (queryType === QueryType.DROP || queryType === QueryType.TRUNCATE) {
      return 'Even in WRITE mode, destructive DDL operations are blocked. Use MySQL CLI directly for these operations.';
    }

    if (NEVER_ALLOWED.includes(queryType)) {
      return 'Administrative commands are never allowed through this MCP server, regardless of mode.';
    }
  }

  return '';
}

/**
 * Parse and validate a SQL query
 */
export function parseQuery(query: string, mode: OperationMode): ParseResult {
  // Normalize the query
  const normalized = normalizeQuery(query);

  // Split into statements
  const statements = splitStatements(normalized);

  // If no statements found, treat as unknown
  if (statements.length === 0) {
    return {
      queryType: QueryType.UNKNOWN,
      allowed: false,
      reason: 'Empty or invalid query',
      suggestion: 'Please provide a valid SQL query.'
    };
  }

  // Check each statement
  for (const statement of statements) {
    const queryType = detectQueryType(statement);
    const allowed = isAllowed(queryType, mode);

    // Log the query attempt
    logQuery(statement, mode, allowed, queryType);

    if (!allowed) {
      return {
        queryType,
        allowed: false,
        reason: explainBlocked(queryType, mode),
        suggestion: suggestFix(queryType, mode)
      };
    }
  }

  // All statements are allowed
  const firstQueryType = detectQueryType(statements[0]);
  return {
    queryType: firstQueryType,
    allowed: true
  };
}
