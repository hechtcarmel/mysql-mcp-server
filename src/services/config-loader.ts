import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { OperationMode, type ServerConfig } from '../types.js';
import { DEFAULT_PORT, DEFAULT_POOL_SIZE, DEFAULT_CONNECTION_TIMEOUT, DEFAULT_QUERY_TIMEOUT } from '../constants.js';

function boolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function integer(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

/** Pure parsing entry point: never modifies the process environment or logs secrets. */
export function parseConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const missing = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD'].filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  const sslEnabled = boolean(env.MYSQL_SSL, false, 'MYSQL_SSL');
  const rejectUnauthorized = boolean(env.MYSQL_SSL_REJECT_UNAUTHORIZED, true, 'MYSQL_SSL_REJECT_UNAUTHORIZED');
  if (Boolean(env.MYSQL_SSL_CERT) !== Boolean(env.MYSQL_SSL_KEY)) {
    throw new Error('MYSQL_SSL_CERT and MYSQL_SSL_KEY must be configured together');
  }
  let ssl: ServerConfig['ssl'];
  if (sslEnabled || env.MYSQL_SSL_CA || env.MYSQL_SSL_CERT || env.MYSQL_SSL_KEY) {
    try {
      ssl = {
        ...(env.MYSQL_SSL_CA && { ca: readFileSync(env.MYSQL_SSL_CA, 'utf8') }),
        ...(env.MYSQL_SSL_CERT && { cert: readFileSync(env.MYSQL_SSL_CERT, 'utf8') }),
        ...(env.MYSQL_SSL_KEY && { key: readFileSync(env.MYSQL_SSL_KEY, 'utf8') }),
        rejectUnauthorized
      };
    } catch {
      throw new Error('Could not read configured MySQL TLS files; check paths and permissions');
    }
  }
  return {
    host: env.MYSQL_HOST!,
    port: integer(env.MYSQL_PORT, DEFAULT_PORT, 1, 65535, 'MYSQL_PORT'),
    user: env.MYSQL_USER!,
    password: env.MYSQL_PASSWORD!,
    ...(env.MYSQL_DATABASE && { database: env.MYSQL_DATABASE }),
    operationMode: boolean(env.MYSQL_ALLOW_WRITE, false, 'MYSQL_ALLOW_WRITE')
      ? OperationMode.WRITE_ENABLED
      : OperationMode.READ_ONLY,
    poolSize: integer(env.MYSQL_POOL_SIZE, DEFAULT_POOL_SIZE, 1, 1000, 'MYSQL_POOL_SIZE'),
    connectionTimeout: integer(
      env.MYSQL_CONNECTION_TIMEOUT,
      DEFAULT_CONNECTION_TIMEOUT,
      1000,
      60000,
      'MYSQL_CONNECTION_TIMEOUT'
    ),
    queryTimeout: integer(env.MYSQL_QUERY_TIMEOUT, DEFAULT_QUERY_TIMEOUT, 1000, 600000, 'MYSQL_QUERY_TIMEOUT'),
    maxRows: integer(env.MYSQL_MAX_ROWS, 1000, 1, 100000, 'MYSQL_MAX_ROWS'),
    ...(ssl && { ssl })
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): ServerConfig {
  // dotenv must stay quiet: stdout belongs exclusively to the MCP transport.
  const result = dotenvConfig({
    path: env.MYSQL_ENV_FILE || resolve(cwd, '.env'),
    processEnv: env,
    override: false,
    quiet: true
  });
  if (result.error && env.MYSQL_ENV_FILE) throw new Error('Failed to load MYSQL_ENV_FILE');
  return parseConfig(env);
}
