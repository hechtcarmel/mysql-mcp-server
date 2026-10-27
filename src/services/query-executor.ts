import { MySQLClient, type StatementResult } from './mysql-client.js';
import { validateQuery } from './query-parser.js';
import { type QueryResult, OperationMode } from '../types.js';
import { logQuery } from '../utils/logger.js';

export class QueryExecutor {
  constructor(
    private readonly mysqlClient: MySQLClient,
    private readonly operationMode: OperationMode
  ) {}

  async executeQuery(query: string, signal?: AbortSignal): Promise<QueryResult> {
    const start = performance.now();
    let statements;
    try {
      statements = validateQuery(query, this.operationMode);
    } catch (error) {
      logQuery(query, this.operationMode, false);
      throw new Error(`Query blocked: ${error instanceof Error ? error.message : 'Invalid SQL'}`, { cause: error });
    }
    logQuery(query, this.operationMode, true, statements[0]!.queryType);
    const results = (await this.mysqlClient.executeStatements(statements, signal)).map(result =>
      this.formatResult(result, Math.round(performance.now() - start))
    );
    const first = results[0]!;
    if (results.length > 1) return { ...first, results, truncated: results.some(result => result.truncated) };
    return first;
  }

  private formatResult(result: StatementResult, executionTime: number): QueryResult {
    if (Array.isArray(result.rows))
      return {
        columns: result.fields.map(field => ({ name: field.name, type: this.getFieldTypeName(field.columnType ?? 0) })),
        rows: result.rows,
        rowCount: result.rows.length,
        executionTime,
        truncated: result.truncated
      };
    return {
      affectedRows: result.rows.affectedRows,
      insertId: result.rows.insertId || 0,
      changedRows: result.rows.changedRows || 0,
      rowCount: result.rows.affectedRows,
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
