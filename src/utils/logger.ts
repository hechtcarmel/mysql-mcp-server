/**
 * Logging utilities for MySQL MCP Server
 * All logging goes to stderr to keep stdout clear for MCP protocol communication
 */

import { OperationMode, QueryType } from '../types.js';
import { LOG_QUERY_TRUNCATE_LENGTH } from '../constants.js';

/**
 * Get current timestamp in ISO format
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Log an informational message
 */
export function logInfo(message: string): void {
  console.error(`[INFO] ${getTimestamp()} - ${message}`);
}

/**
 * Log a warning message
 */
export function logWarning(message: string): void {
  console.error(`[WARN] ${getTimestamp()} - ${message}`);
}

/**
 * Log an error message with optional error object
 */
export function logError(message: string, error?: unknown): void {
  console.error(`[ERROR] ${getTimestamp()} - ${message}`);
  if (error) {
    console.error(error);
  }
}

/**
 * Truncate a string for safe logging
 */
function truncateForLog(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + '...';
}

/**
 * Log query execution for audit trail
 */
export function logQuery(query: string, mode: OperationMode, allowed: boolean, queryType?: QueryType): void {
  const status = allowed ? 'EXECUTED' : 'BLOCKED';
  const typeInfo = queryType ? ` (${queryType})` : '';
  const truncatedQuery = truncateForLog(query, LOG_QUERY_TRUNCATE_LENGTH);
  logInfo(`Query ${status} [${mode}]${typeInfo}: ${truncatedQuery}`);
}

/**
 * Log server startup information
 */
export function logServerStartup(mode: OperationMode, host: string, port: number): void {
  console.error('='.repeat(60));
  logInfo('MySQL MCP Server starting...');
  logInfo(`Operation Mode: ${mode}`);
  logInfo(`MySQL Host: ${host}:${port}`);

  if (mode === OperationMode.WRITE_ENABLED) {
    logWarning('⚠️  WRITE MODE ENABLED - Data modification is allowed!');
    logWarning('⚠️  Ensure proper access controls are in place.');
  } else {
    logInfo('✓ READ-ONLY mode active (safe default)');
  }

  console.error('='.repeat(60));
}

/**
 * Log connection pool information
 */
export function logPoolConfig(poolSize: number, connectionTimeout: number, queryTimeout: number): void {
  logInfo(`Connection pool size: ${poolSize}`);
  logInfo(`Connection timeout: ${connectionTimeout}ms`);
  logInfo(`Query timeout: ${queryTimeout}ms`);
}

/**
 * Log SSL configuration status
 */
export function logSSLConfig(sslEnabled: boolean): void {
  if (sslEnabled) {
    logInfo('✓ SSL/TLS enabled');
  } else {
    logInfo('SSL/TLS not configured (unencrypted connection)');
  }
}
