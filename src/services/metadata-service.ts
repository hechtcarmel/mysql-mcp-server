/**
 * Metadata service for retrieving database schema information
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { MySQLClient } from './mysql-client.js';
import { DatabaseInfo, TableInfo, TableSchema, ColumnInfo, IndexInfo, ForeignKeyInfo } from '../types.js';
import { SYSTEM_DATABASES } from '../constants.js';
import type { RowDataPacket } from 'mysql2/promise';

/**
 * Metadata service class
 */
export class MetadataService {
  constructor(private mysqlClient: MySQLClient) {}

  /**
   * List all accessible databases (excluding system databases)
   */
  async listDatabases(): Promise<DatabaseInfo[]> {
    const query = `
      SELECT
        SCHEMA_NAME as name,
        DEFAULT_CHARACTER_SET_NAME as defaultCharacterSet,
        DEFAULT_COLLATION_NAME as defaultCollation
      FROM INFORMATION_SCHEMA.SCHEMATA
      WHERE SCHEMA_NAME NOT IN (${SYSTEM_DATABASES.map(() => '?').join(', ')})
      ORDER BY SCHEMA_NAME
    `;

    const [rows] = await this.mysqlClient.executeQuery(query);
    const databases = rows as RowDataPacket[];

    // Get table count for each database
    const result: DatabaseInfo[] = [];
    for (const db of databases) {
      const tableCountQuery = `
        SELECT COUNT(*) as count
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ?
      `;

      const [countRows] = await this.mysqlClient.executeQuery(tableCountQuery);
      const countResult = countRows as RowDataPacket[];
      const tableCount = countResult[0]?.count || 0;

      result.push({
        name: db.name,
        defaultCharacterSet: db.defaultCharacterSet,
        defaultCollation: db.defaultCollation,
        tableCount: Number(tableCount)
      });
    }

    return result;
  }

  /**
   * Get database information and table list
   */
  async getDatabaseInfo(database: string): Promise<{
    database: { name: string; characterSet: string; collation: string };
    tables: TableInfo[];
  }> {
    // Get database info
    const dbQuery = `
      SELECT
        SCHEMA_NAME as name,
        DEFAULT_CHARACTER_SET_NAME as characterSet,
        DEFAULT_COLLATION_NAME as collation
      FROM INFORMATION_SCHEMA.SCHEMATA
      WHERE SCHEMA_NAME = ?
    `;

    const [dbRows] = await this.mysqlClient.executeQuery(dbQuery);
    const dbResult = dbRows as RowDataPacket[];

    if (dbResult.length === 0) {
      throw new Error(`Database '${database}' does not exist or is not accessible`);
    }

    const dbInfo = {
      name: dbResult[0].name,
      characterSet: dbResult[0].characterSet,
      collation: dbResult[0].collation
    };

    // Get table list
    const tablesQuery = `
      SELECT
        TABLE_NAME as name,
        TABLE_TYPE as type,
        ENGINE as engine,
        TABLE_ROWS as rowCount,
        DATA_LENGTH as dataLength,
        INDEX_LENGTH as indexLength,
        TABLE_COMMENT as comment
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `;

    const [tableRows] = await this.mysqlClient.executeQuery(tablesQuery);
    const tables = (tableRows as RowDataPacket[]).map(row => ({
      name: row.name,
      type: row.type,
      engine: row.engine,
      rowCount: Number(row.rowCount || 0),
      dataLength: Number(row.dataLength || 0),
      indexLength: Number(row.indexLength || 0),
      comment: row.comment || ''
    }));

    return { database: dbInfo, tables };
  }

  /**
   * Get complete table schema including columns, indexes, and foreign keys
   */
  async getTableSchema(database: string, table: string): Promise<TableSchema> {
    // Get table information
    const tableQuery = `
      SELECT
        TABLE_SCHEMA as \`database\`,
        TABLE_NAME as name,
        TABLE_TYPE as type,
        ENGINE as engine,
        ROW_FORMAT as rowFormat,
        TABLE_ROWS as rowCount,
        AVG_ROW_LENGTH as avgRowLength,
        DATA_LENGTH as dataLength,
        MAX_DATA_LENGTH as maxDataLength,
        INDEX_LENGTH as indexLength,
        AUTO_INCREMENT as autoIncrement,
        CREATE_TIME as createTime,
        UPDATE_TIME as updateTime,
        TABLE_COMMENT as comment
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `;

    const [tableRows] = await this.mysqlClient.executeQuery(tableQuery);
    const tableResult = tableRows as RowDataPacket[];

    if (tableResult.length === 0) {
      throw new Error(`Table '${database}.${table}' does not exist or is not accessible`);
    }

    const tableInfo = tableResult[0];

    // Get columns
    const columnsQuery = `
      SELECT
        COLUMN_NAME as name,
        ORDINAL_POSITION as ordinalPosition,
        DATA_TYPE as dataType,
        COLUMN_TYPE as columnType,
        IS_NULLABLE as isNullable,
        COLUMN_KEY as columnKey,
        COLUMN_DEFAULT as defaultValue,
        EXTRA as extra,
        COLUMN_COMMENT as comment,
        CHARACTER_SET_NAME as characterSet,
        COLLATION_NAME as collation
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `;

    const [columnRows] = await this.mysqlClient.executeQuery(columnsQuery);
    const columns: ColumnInfo[] = (columnRows as RowDataPacket[]).map(row => ({
      name: row.name,
      ordinalPosition: Number(row.ordinalPosition),
      dataType: row.dataType,
      columnType: row.columnType,
      isNullable: row.isNullable === 'YES',
      columnKey: row.columnKey || '',
      defaultValue: row.defaultValue,
      extra: row.extra || '',
      comment: row.comment || '',
      characterSet: row.characterSet,
      collation: row.collation
    }));

    // Get indexes
    const indexesQuery = `
      SELECT
        INDEX_NAME as name,
        NON_UNIQUE as nonUnique,
        COLUMN_NAME as columnName,
        SEQ_IN_INDEX as seqInIndex,
        INDEX_TYPE as indexType,
        INDEX_COMMENT as comment
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `;

    const [indexRows] = await this.mysqlClient.executeQuery(indexesQuery);
    const indexData = indexRows as RowDataPacket[];

    // Group indexes by name
    const indexMap = new Map<string, { unique: boolean; columns: string[]; indexType: string; comment: string }>();
    for (const row of indexData) {
      const indexName = row.name;
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, {
          unique: row.nonUnique === 0,
          columns: [],
          indexType: row.indexType,
          comment: row.comment || ''
        });
      }
      indexMap.get(indexName)!.columns.push(row.columnName);
    }

    const indexes: IndexInfo[] = Array.from(indexMap.entries()).map(([name, info]) => ({
      name,
      unique: info.unique,
      columns: info.columns,
      indexType: info.indexType,
      comment: info.comment
    }));

    // Get foreign keys
    const fkQuery = `
      SELECT
        CONSTRAINT_NAME as name,
        COLUMN_NAME as columnName,
        ORDINAL_POSITION as position,
        REFERENCED_TABLE_NAME as referencedTable,
        REFERENCED_COLUMN_NAME as referencedColumn
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
    `;

    const [fkRows] = await this.mysqlClient.executeQuery(fkQuery);
    const fkData = fkRows as RowDataPacket[];

    // Group foreign keys by constraint name
    const fkMap = new Map<string, { columns: string[]; referencedTable: string; referencedColumns: string[] }>();
    for (const row of fkData) {
      const fkName = row.name;
      if (!fkMap.has(fkName)) {
        fkMap.set(fkName, {
          columns: [],
          referencedTable: row.referencedTable,
          referencedColumns: []
        });
      }
      fkMap.get(fkName)!.columns.push(row.columnName);
      fkMap.get(fkName)!.referencedColumns.push(row.referencedColumn);
    }

    // Get UPDATE_RULE and DELETE_RULE for foreign keys
    const fkRulesQuery = `
      SELECT
        CONSTRAINT_NAME as name,
        UPDATE_RULE as onUpdate,
        DELETE_RULE as onDelete
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?
    `;

    const [fkRulesRows] = await this.mysqlClient.executeQuery(fkRulesQuery);
    const fkRulesData = fkRulesRows as RowDataPacket[];
    const fkRulesMap = new Map<string, { onUpdate: string; onDelete: string }>();
    for (const row of fkRulesData) {
      fkRulesMap.set(row.name, {
        onUpdate: row.onUpdate,
        onDelete: row.onDelete
      });
    }

    const foreignKeys: ForeignKeyInfo[] = Array.from(fkMap.entries()).map(([name, info]) => {
      const rules = fkRulesMap.get(name) || { onUpdate: 'RESTRICT', onDelete: 'RESTRICT' };
      return {
        name,
        columns: info.columns,
        referencedTable: info.referencedTable,
        referencedColumns: info.referencedColumns,
        onUpdate: rules.onUpdate,
        onDelete: rules.onDelete
      };
    });

    return {
      table: {
        database: tableInfo.database,
        name: tableInfo.name,
        type: tableInfo.type,
        engine: tableInfo.engine,
        rowFormat: tableInfo.rowFormat,
        rowCount: Number(tableInfo.rowCount || 0),
        avgRowLength: Number(tableInfo.avgRowLength || 0),
        dataLength: Number(tableInfo.dataLength || 0),
        maxDataLength: Number(tableInfo.maxDataLength || 0),
        indexLength: Number(tableInfo.indexLength || 0),
        autoIncrement: tableInfo.autoIncrement ? Number(tableInfo.autoIncrement) : null,
        createTime: tableInfo.createTime ? new Date(tableInfo.createTime) : null,
        updateTime: tableInfo.updateTime ? new Date(tableInfo.updateTime) : null,
        comment: tableInfo.comment || ''
      },
      columns,
      indexes,
      foreignKeys
    };
  }
}
