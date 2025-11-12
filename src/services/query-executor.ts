/**
 * Query executor service
 * Executes validated SQL queries and returns formatted results
 */

import { MySQLClient } from './mysql-client.js';
import { parseQuery } from './query-parser.js';
import { QueryResult, OperationMode } from '../types.js';
import type { RowDataPacket, OkPacket, FieldPacket } from 'mysql2/promise';

/**
 * Query executor class
 */
export class QueryExecutor {
  constructor(
    private mysqlClient: MySQLClient,
    private operationMode: OperationMode
  ) {}

  /**
   * Execute a SQL query with validation and timing
   */
  async executeQuery(query: string): Promise<QueryResult> {
    // Parse and validate query
    const parseResult = parseQuery(query, this.operationMode);

    if (!parseResult.allowed) {
      throw new Error(
        `Query blocked: ${parseResult.reason}\n\n${parseResult.suggestion || ''}`
      );
    }

    // Execute query with timing
    const startTime = Date.now();
    try {
      const [rows, fields] = await this.mysqlClient.executeQuery(query);
      const executionTime = Date.now() - startTime;

      // Format result based on query type
      return this.formatResult(rows, fields, executionTime);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      // Re-throw with execution time context
      if (error instanceof Error) {
        error.message = `${error.message} (execution time: ${executionTime}ms)`;
      }
      throw error;
    }
  }

  /**
   * Format query result based on type
   */
  private formatResult(
    rows: RowDataPacket[] | RowDataPacket[][] | OkPacket | OkPacket[],
    fields: FieldPacket[],
    executionTime: number
  ): QueryResult {
    // Handle SELECT queries (returns rows)
    if (Array.isArray(rows) && rows.length >= 0 && !('affectedRows' in rows)) {
      const rowData = rows as RowDataPacket[];

      // Extract column information
      const columns = fields.map(field => ({
        name: field.name,
        type: this.getFieldTypeName(field.type || 0)
      }));

      // Convert rows to array format
      const rowArray = rowData.map(row => {
        return fields.map(field => row[field.name]);
      });

      return {
        columns,
        rows: rowArray,
        rowCount: rowData.length,
        executionTime,
        truncated: false
      };
    }

    // Handle DML queries (INSERT, UPDATE, DELETE, REPLACE)
    if ('affectedRows' in rows) {
      const okPacket = rows as OkPacket;
      return {
        affectedRows: okPacket.affectedRows,
        insertId: okPacket.insertId || 0,
        changedRows: okPacket.changedRows || 0,
        rowCount: okPacket.affectedRows,
        executionTime,
        truncated: false
      };
    }

    // Handle other query types (SHOW, DESCRIBE, etc.)
    if (Array.isArray(rows) && rows.length > 0) {
      const rowData = rows as RowDataPacket[];

      const columns = fields.map(field => ({
        name: field.name,
        type: this.getFieldTypeName(field.type || 0)
      }));

      const rowArray = rowData.map(row => {
        return fields.map(field => row[field.name]);
      });

      return {
        columns,
        rows: rowArray,
        rowCount: rowData.length,
        executionTime,
        truncated: false
      };
    }

    // Default empty result
    return {
      rowCount: 0,
      executionTime,
      truncated: false
    };
  }

  /**
   * Get human-readable field type name
   */
  private getFieldTypeName(type: number): string {
    // MySQL field type constants from mysql2
    const typeMap: { [key: number]: string } = {
      0: 'DECIMAL',
      1: 'TINY',
      2: 'SHORT',
      3: 'LONG',
      4: 'FLOAT',
      5: 'DOUBLE',
      6: 'NULL',
      7: 'TIMESTAMP',
      8: 'LONGLONG',
      9: 'INT24',
      10: 'DATE',
      11: 'TIME',
      12: 'DATETIME',
      13: 'YEAR',
      15: 'VARCHAR',
      16: 'BIT',
      245: 'JSON',
      246: 'NEWDECIMAL',
      247: 'ENUM',
      248: 'SET',
      249: 'TINY_BLOB',
      250: 'MEDIUM_BLOB',
      251: 'LONG_BLOB',
      252: 'BLOB',
      253: 'VAR_STRING',
      254: 'STRING',
      255: 'GEOMETRY'
    };

    return typeMap[type] || `UNKNOWN(${type})`;
  }
}
