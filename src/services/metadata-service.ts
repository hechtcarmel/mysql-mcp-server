import { MySQLClient } from './mysql-client.js';
import type { DatabaseInfo, TableInfo, TableSchema, ColumnInfo, IndexInfo, ForeignKeyInfo } from '../types.js';
import { SYSTEM_DATABASES } from '../constants.js';

type Numeric = number | string | null;
export class MetadataNotFoundError extends Error {}

export class MetadataService {
  constructor(private readonly mysqlClient: MySQLClient) {}

  private async rows<T>(sql: string, values: readonly string[], signal?: AbortSignal): Promise<T[]> {
    const [rows] = await this.mysqlClient.executeQuery(sql, values, signal);
    if (!Array.isArray(rows)) throw new Error('Expected metadata rows');
    return rows as T[];
  }

  async listDatabases(signal?: AbortSignal): Promise<DatabaseInfo[]> {
    const rows = await this.rows<Omit<DatabaseInfo, 'tableCount'> & { tableCount: Numeric }>(
      `
      SELECT s.SCHEMA_NAME AS name, s.DEFAULT_CHARACTER_SET_NAME AS defaultCharacterSet,
        s.DEFAULT_COLLATION_NAME AS defaultCollation, COUNT(t.TABLE_NAME) AS tableCount
      FROM INFORMATION_SCHEMA.SCHEMATA s
      LEFT JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
      WHERE s.SCHEMA_NAME NOT IN (${SYSTEM_DATABASES.map(() => '?').join(', ')})
      GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME
      ORDER BY s.SCHEMA_NAME`,
      SYSTEM_DATABASES,
      signal
    );
    return rows.map(row => ({ ...row, tableCount: Number(row.tableCount ?? 0) }));
  }

  async getDatabaseInfo(
    database: string,
    signal?: AbortSignal
  ): Promise<{
    database: { name: string; characterSet: string; collation: string };
    tables: TableInfo[];
  }> {
    const databases = await this.rows<{ name: string; characterSet: string; collation: string }>(
      `
      SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS characterSet,
        DEFAULT_COLLATION_NAME AS collation FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [database],
      signal
    );
    if (!databases[0]) throw new MetadataNotFoundError('Database does not exist or is not accessible');
    const tables = await this.rows<
      Omit<TableInfo, 'rowCount' | 'dataLength' | 'indexLength'> & {
        rowCount: Numeric;
        dataLength: Numeric;
        indexLength: Numeric;
      }
    >(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_ROWS AS rowCount,
      DATA_LENGTH AS dataLength, INDEX_LENGTH AS indexLength, TABLE_COMMENT AS comment
      FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [database],
      signal
    );
    return {
      database: databases[0],
      tables: tables.map(row => ({
        ...row,
        rowCount: Number(row.rowCount ?? 0),
        dataLength: Number(row.dataLength ?? 0),
        indexLength: Number(row.indexLength ?? 0)
      }))
    };
  }

  async getTableSchema(database: string, table: string, signal?: AbortSignal): Promise<TableSchema> {
    const values = [database, table];
    const tables = await this.rows<TableSchema['table']>(
      `
      SELECT TABLE_SCHEMA AS \`database\`, TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine,
        ROW_FORMAT AS rowFormat, TABLE_ROWS AS rowCount, AVG_ROW_LENGTH AS avgRowLength,
        DATA_LENGTH AS dataLength, MAX_DATA_LENGTH AS maxDataLength, INDEX_LENGTH AS indexLength,
        AUTO_INCREMENT AS autoIncrement, CREATE_TIME AS createTime, UPDATE_TIME AS updateTime, TABLE_COMMENT AS comment
      FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      values,
      signal
    );
    const info = tables[0];
    if (!info) throw new MetadataNotFoundError('Table does not exist or is not accessible');
    const columns = await this.rows<Omit<ColumnInfo, 'isNullable'> & { isNullable: string }>(
      `
      SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS ordinalPosition, DATA_TYPE AS dataType,
        COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_KEY AS columnKey,
        COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment,
        CHARACTER_SET_NAME AS characterSet, COLLATION_NAME AS collation
      FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      values,
      signal
    );
    const indexRows = await this.rows<{
      name: string;
      nonUnique: Numeric;
      columnName: string | null;
      indexType: string;
      comment: string;
    }>(
      `
      SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName,
        INDEX_TYPE AS indexType, INDEX_COMMENT AS comment
      FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      values,
      signal
    );
    const indexMap = new Map<string, IndexInfo>();
    for (const row of indexRows) {
      const index = indexMap.get(row.name) ?? {
        name: row.name,
        unique: Number(row.nonUnique) === 0,
        columns: [],
        indexType: row.indexType,
        comment: row.comment ?? ''
      };
      index.columns.push(row.columnName ?? '(expression)');
      indexMap.set(row.name, index);
    }
    const fkRows = await this.rows<{
      name: string;
      columnName: string;
      referencedTable: string;
      referencedDatabase: string;
      referencedColumn: string;
      onUpdate: string;
      onDelete: string;
    }>(
      `
      SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase,
        k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn,
        r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      values,
      signal
    );
    const fkMap = new Map<string, ForeignKeyInfo>();
    for (const row of fkRows) {
      const foreignKey = fkMap.get(row.name) ?? {
        name: row.name,
        columns: [],
        referencedTable: `${row.referencedDatabase}.${row.referencedTable}`,
        referencedColumns: [],
        onUpdate: row.onUpdate,
        onDelete: row.onDelete
      };
      foreignKey.columns.push(row.columnName);
      foreignKey.referencedColumns.push(row.referencedColumn);
      fkMap.set(row.name, foreignKey);
    }
    return {
      table: {
        ...info,
        rowCount: Number(info.rowCount ?? 0),
        avgRowLength: Number(info.avgRowLength ?? 0),
        dataLength: Number(info.dataLength ?? 0),
        maxDataLength: Number(info.maxDataLength ?? 0),
        indexLength: Number(info.indexLength ?? 0),
        autoIncrement: info.autoIncrement,
        createTime: info.createTime ? new Date(info.createTime) : null,
        updateTime: info.updateTime ? new Date(info.updateTime) : null
      },
      columns: columns.map(row => ({
        ...row,
        ordinalPosition: Number(row.ordinalPosition),
        isNullable: row.isNullable === 'YES'
      })),
      indexes: [...indexMap.values()],
      foreignKeys: [...fkMap.values()]
    };
  }
}
