/**
 * Type definitions for MySQL MCP Server
 */

import type { RowDataPacket, OkPacket, FieldPacket } from 'mysql2/promise';

/**
 * Operation mode for the server
 */
export enum OperationMode {
  READ_ONLY = 'READ_ONLY',
  WRITE_ENABLED = 'WRITE_ENABLED'
}

/**
 * SQL query types detected by the parser
 */
export enum QueryType {
  // Read operations
  SELECT = 'SELECT',
  SHOW = 'SHOW',
  DESCRIBE = 'DESCRIBE',
  EXPLAIN = 'EXPLAIN',
  USE = 'USE',

  // Write operations (DML)
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  REPLACE = 'REPLACE',

  // DDL operations
  CREATE = 'CREATE',
  ALTER = 'ALTER',
  DROP = 'DROP',
  TRUNCATE = 'TRUNCATE',

  // Transaction control
  START_TRANSACTION = 'START_TRANSACTION',
  COMMIT = 'COMMIT',
  ROLLBACK = 'ROLLBACK',
  SAVEPOINT = 'SAVEPOINT',

  // Administrative commands
  GRANT = 'GRANT',
  REVOKE = 'REVOKE',
  FLUSH = 'FLUSH',
  KILL = 'KILL',
  LOAD_DATA = 'LOAD_DATA',
  SET = 'SET',

  // Unknown
  UNKNOWN = 'UNKNOWN'
}

/**
 * Server configuration loaded from environment variables
 */
export interface ServerConfig {
  // Connection parameters
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;

  // Operation mode
  operationMode: OperationMode;

  // Pool configuration
  poolSize: number;
  connectionTimeout: number;
  queryTimeout: number;

  // SSL configuration
  ssl?: {
    ca?: string;
    cert?: string;
    key?: string;
    rejectUnauthorized: boolean;
  };
}

/**
 * Result of query parsing
 */
export interface ParseResult {
  queryType: QueryType;
  allowed: boolean;
  reason?: string;
  suggestion?: string;
}

/**
 * Query execution result
 */
export interface QueryResult {
  // For SELECT queries
  columns?: Array<{
    name: string;
    type: string;
  }>;
  rows?: unknown[][];

  // For DML queries
  affectedRows?: number;
  insertId?: number;
  changedRows?: number;

  // Metadata
  rowCount: number;
  executionTime: number;
  warnings?: string[];
  truncated?: boolean;
}

/**
 * Database information
 */
export interface DatabaseInfo {
  name: string;
  defaultCharacterSet: string;
  defaultCollation: string;
  tableCount: number;
}

/**
 * Table information
 */
export interface TableInfo {
  name: string;
  type: 'BASE TABLE' | 'VIEW';
  engine: string | null;
  rowCount: number;
  dataLength: number;
  indexLength: number;
  comment: string;
}

/**
 * Column information
 */
export interface ColumnInfo {
  name: string;
  ordinalPosition: number;
  dataType: string;
  columnType: string;
  isNullable: boolean;
  columnKey: 'PRI' | 'UNI' | 'MUL' | '';
  defaultValue: string | null;
  extra: string;
  comment: string;
  characterSet: string | null;
  collation: string | null;
}

/**
 * Index information
 */
export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
  indexType: string;
  comment: string;
}

/**
 * Foreign key information
 */
export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: string;
  onDelete: string;
}

/**
 * Complete table schema
 */
export interface TableSchema {
  table: {
    database: string;
    name: string;
    type: 'BASE TABLE' | 'VIEW';
    engine: string | null;
    rowFormat: string | null;
    rowCount: number;
    avgRowLength: number;
    dataLength: number;
    maxDataLength: number;
    indexLength: number;
    autoIncrement: number | null;
    createTime: Date | null;
    updateTime: Date | null;
    comment: string;
  };
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

/**
 * Database resource response
 */
export interface DatabaseResource {
  database: {
    name: string;
    characterSet: string;
    collation: string;
  };
  tables: TableInfo[];
  tableCount: number;
}

/**
 * MySQL query result types from mysql2
 */
export type MySQLQueryResult = [RowDataPacket[] | RowDataPacket[][] | OkPacket | OkPacket[], FieldPacket[]];
