import mysql from 'mysql2';
import { Duplex } from 'node:stream';
import type { Pool, PoolConnection, FieldPacket, ResultSetHeader, RowDataPacket } from 'mysql2';
import { OperationMode, type ServerConfig, type MySQLQueryResult } from '../types.js';
import { CHARACTER_LIMIT } from '../constants.js';
import type { Statement } from './query-parser.js';

export interface StatementResult {
  rows: unknown[][] | ResultSetHeader;
  fields: FieldPacket[];
  truncated: boolean;
}

/** The pool never accepts multi-statements. Validated batches execute one statement at a time. */
export class MySQLClient {
  private pool: Pool | null = null;
  private closing: Promise<void> | undefined;
  private activeConnections = new Set<PoolConnection>();
  private cancellations = new Set<(error: Error) => void>();

  constructor(private readonly config: ServerConfig) {}

  initialize(): void {
    if (this.pool) return;
    if (this.closing) throw new Error('MySQL client is closing');
    this.pool = mysql.createPool({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      ssl: this.config.ssl,
      connectionLimit: this.config.poolSize,
      connectTimeout: this.config.connectionTimeout,
      waitForConnections: true,
      queueLimit: this.config.poolSize * 10,
      enableKeepAlive: true,
      multipleStatements: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      dateStrings: false,
      decimalNumbers: false
    });
  }

  /** Includes pool wait, execution, and cleanup in one deadline; late acquisitions are destroyed. */
  private async withConnection<T>(
    work: (connection: PoolConnection) => Promise<T>,
    signal?: AbortSignal,
    timeout = this.config.queryTimeout
  ): Promise<T> {
    const pool = this.pool;
    if (!pool || this.closing) throw new Error('MySQL client is not running');
    signal?.throwIfAborted();
    let connection: PoolConnection | undefined;
    let cancelled = false;
    let timer: NodeJS.Timeout | undefined;
    let abort: () => void = () => {};
    let cancel: (error: Error) => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      cancel = (error: Error): void => {
        if (cancelled) return;
        cancelled = true;
        if (connection) this.destroyConnection(connection);
        reject(error);
      };
      this.cancellations.add(cancel);
      abort = () => cancel(new Error('Query cancelled; a write may have completed before cancellation'));
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(
        () =>
          cancel(
            Object.assign(new Error(`Query execution timeout exceeded (${timeout}ms); a write may have completed`), {
              code: 'MYSQL_REQUEST_TIMEOUT'
            })
          ),
        timeout
      );
    });
    const operation = (async () => {
      connection = await new Promise<PoolConnection>((resolve, reject) => {
        pool.getConnection((error, acquired) => (error ? reject(error) : resolve(acquired)));
      });
      if (cancelled || this.closing) {
        this.destroyConnection(connection);
        throw new Error('Query cancelled');
      }
      this.activeConnections.add(connection);
      try {
        const value = await work(connection);
        if (!cancelled) connection.release();
        return value;
      } catch (error) {
        // Never put a failed or partially consumed session back into the pool.
        this.destroyConnection(connection);
        throw error;
      } finally {
        this.activeConnections.delete(connection);
      }
    })();
    try {
      return await Promise.race([operation, stopped]);
    } finally {
      clearTimeout(timer);
      this.cancellations.delete(cancel);
      signal?.removeEventListener('abort', abort);
    }
  }

  async testConnection(): Promise<boolean> {
    await this.executeQuery('SELECT 1');
    return true;
  }

  /** Internal metadata uses actual prepared parameters, never interpolation. */
  async executeQuery(sql: string, values: readonly string[] = [], signal?: AbortSignal): Promise<MySQLQueryResult> {
    return this.withConnection(async connection => {
      const [rows, fields] = await connection.promise().execute<RowDataPacket[] | ResultSetHeader>(sql, [...values]);
      return [rows, fields];
    }, signal);
  }

  async executeStatements(statements: Statement[], signal?: AbortSignal): Promise<StatementResult[]> {
    return this.withConnection(async connection => {
      const readonly = this.config.operationMode === OperationMode.READ_ONLY;
      if (readonly) await connection.promise().query('START TRANSACTION READ ONLY');
      const results: StatementResult[] = [];
      let remainingRows = this.config.maxRows;
      let remainingCharacters = CHARACTER_LIMIT;
      for (const statement of statements) {
        signal?.throwIfAborted();
        const result = await this.streamQuery(connection, statement.sql, remainingRows, remainingCharacters);
        results.push(result);
        if (Array.isArray(result.rows)) {
          remainingRows -= result.rows.length;
          remainingCharacters -= JSON.stringify(result.rows).length;
        }
      }
      // Also clears savepoints and any implicit transaction state before pool reuse.
      await connection.promise().query('ROLLBACK');
      return results;
    }, signal);
  }

  private streamQuery(
    connection: PoolConnection,
    sql: string,
    maxRows: number,
    maxCharacters: number
  ): Promise<StatementResult> {
    return new Promise((resolve, reject) => {
      let fields: FieldPacket[] = [];
      const rows: unknown[][] = [];
      let header: ResultSetHeader | undefined;
      let size = 0;
      let truncated = false;
      // Event mode avoids mysql2 buffering the full result set. Surplus rows are discarded.
      const query = connection.query({ sql, rowsAsArray: true });
      query.on('fields', (value: FieldPacket[]) => {
        fields = value;
      });
      query.on('result', (row: unknown[] | ResultSetHeader) => {
        if (!Array.isArray(row)) {
          header = row;
          return;
        }
        const length = JSON.stringify(row).length;
        if (truncated || rows.length >= maxRows || size + length > maxCharacters) {
          truncated = true;
          return;
        }
        size += length;
        rows.push(row);
      });
      query.on('error', reject);
      query.on('end', () => resolve({ rows: header ?? rows, fields, truncated }));
    });
  }

  private destroyConnection(connection: PoolConnection): void {
    this.activeConnections.delete(connection);
    connection.destroy();
    // mysql2 3.x destroy() only calls stream.end(): a running query can keep the
    // socket alive indefinitely. Isolate this driver-specific seam and force-close
    // its TCP/TLS transport so cancellation and process shutdown really finish.
    const stream: unknown = Reflect.get(connection, 'stream');
    if (stream instanceof Duplex) stream.destroy();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    const pool = this.pool;
    this.pool = null;
    for (const cancel of this.cancellations) cancel(new Error('MySQL client is shutting down'));
    for (const connection of this.activeConnections) this.destroyConnection(connection);
    this.activeConnections.clear();
    this.closing = pool
      ? new Promise<void>((resolve, reject) => pool.end(error => (error ? reject(error) : resolve())))
      : Promise.resolve();
    return this.closing;
  }
}
