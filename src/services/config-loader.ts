/**
 * Configuration loader for MySQL MCP Server
 * Loads and validates environment variables
 */

import { readFileSync } from 'fs';
import { config as dotenvConfig } from 'dotenv';
import { ServerConfig, OperationMode } from '../types.js';
import {
  DEFAULT_PORT,
  DEFAULT_POOL_SIZE,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_QUERY_TIMEOUT
} from '../constants.js';

/**
 * Parse a boolean environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Parse a numeric environment variable with validation
 */
function parseNumber(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  name: string
): number {
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid ${name}: "${value}" is not a valid number`);
  }

  if (parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}: ${parsed} is out of range [${min}, ${max}]`);
  }

  return parsed;
}

/**
 * Load environment variables from a .env file
 * Supports both MYSQL_ENV_FILE and default .env loading
 */
function loadEnvFile(): void {
  // If MYSQL_ENV_FILE is specified, load from that file
  const envFilePath = process.env.MYSQL_ENV_FILE;
  if (envFilePath) {
    try {
      const result = dotenvConfig({ path: envFilePath, override: false });
      if (result.error) {
        throw result.error;
      }
    } catch (error) {
      throw new Error(`Failed to load .env file from ${envFilePath}: ${error}`);
    }
  } else {
    // Otherwise, try to load from default .env file in current directory
    // This is useful when running locally or in development
    dotenvConfig({ override: false });
  }
}

/**
 * Validate required environment variables
 */
function validateRequiredVars(): void {
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD'];
  const missing: string[] = [];

  for (const varName of required) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please set these variables or create a .env file.\n' +
      'See .env.example for configuration template.'
    );
  }
}

/**
 * Load SSL configuration if provided
 */
function loadSSLConfig(): ServerConfig['ssl'] | undefined {
  const sslCA = process.env.MYSQL_SSL_CA;
  const sslCert = process.env.MYSQL_SSL_CERT;
  const sslKey = process.env.MYSQL_SSL_KEY;

  if (!sslCA && !sslCert && !sslKey) {
    return undefined;
  }

  let ca: string | undefined;
  let cert: string | undefined;
  let key: string | undefined;

  try {
    if (sslCA) ca = readFileSync(sslCA, 'utf-8');
    if (sslCert) cert = readFileSync(sslCert, 'utf-8');
    if (sslKey) key = readFileSync(sslKey, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read SSL certificate files: ${error}`);
  }

  return {
    ca,
    cert,
    key,
    rejectUnauthorized: parseBoolean(process.env.MYSQL_SSL_REJECT_UNAUTHORIZED, true)
  };
}

/**
 * Load and validate server configuration from environment variables
 */
export function loadConfig(): ServerConfig {
  // Load .env file if specified
  loadEnvFile();

  // Validate required variables
  validateRequiredVars();

  // Parse operation mode
  const allowWrite = parseBoolean(process.env.MYSQL_ALLOW_WRITE, false);
  const operationMode = allowWrite ? OperationMode.WRITE_ENABLED : OperationMode.READ_ONLY;

  // Parse connection parameters
  const host = process.env.MYSQL_HOST!;
  const port = parseNumber(process.env.MYSQL_PORT, DEFAULT_PORT, 1, 65535, 'MYSQL_PORT');
  const user = process.env.MYSQL_USER!;
  const password = process.env.MYSQL_PASSWORD!;
  const database = process.env.MYSQL_DATABASE;

  // Parse pool configuration
  const poolSize = parseNumber(
    process.env.MYSQL_POOL_SIZE,
    DEFAULT_POOL_SIZE,
    1,
    1000,
    'MYSQL_POOL_SIZE'
  );
  const connectionTimeout = parseNumber(
    process.env.MYSQL_CONNECTION_TIMEOUT,
    DEFAULT_CONNECTION_TIMEOUT,
    1000,
    60000,
    'MYSQL_CONNECTION_TIMEOUT'
  );
  const queryTimeout = parseNumber(
    process.env.MYSQL_QUERY_TIMEOUT,
    DEFAULT_QUERY_TIMEOUT,
    1000,
    600000,
    'MYSQL_QUERY_TIMEOUT'
  );

  // Load SSL configuration
  const ssl = loadSSLConfig();

  return {
    host,
    port,
    user,
    password,
    database,
    operationMode,
    poolSize,
    connectionTimeout,
    queryTimeout,
    ssl
  };
}
