import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RowDataPacket } from 'mysql2';
import { MySQLClient } from '../src/services/mysql-client.js';
import { MetadataService } from '../src/services/metadata-service.js';
import { parseConfig } from '../src/services/config-loader.js';
import {
  formatDatabaseAsMarkdown,
  formatDatabaseListAsMarkdown,
  formatTableSchemaAsMarkdown
} from '../src/utils/formatters.js';

const client = new MySQLClient(parseConfig({ MYSQL_HOST: 'test', MYSQL_USER: 'test', MYSQL_PASSWORD: 'test' }));
const query = vi.spyOn(client, 'executeQuery');
const service = new MetadataService(client);
const rows = (data: object[]) => [data as RowDataPacket[], []] as [RowDataPacket[], []];
beforeEach(() => {
  query.mockReset();
});
describe('prepared metadata queries', () => {
  it('aggregates table counts in one query and binds all system schema exclusions', async () => {
    query.mockResolvedValueOnce(
      rows([{ name: 'shop', defaultCharacterSet: 'utf8mb4', defaultCollation: 'bin', tableCount: '2' }])
    );
    const result = await service.listDatabases();
    expect(result[0]?.tableCount).toBe(2);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual(['information_schema', 'performance_schema', 'mysql', 'sys']);
    expect(query.mock.calls[0]?.[0]).toContain('LEFT JOIN');
    expect(formatDatabaseListAsMarkdown(result)).toContain('| shop | utf8mb4 | bin | 2 |');
    expect(formatDatabaseListAsMarkdown([])).toContain('No accessible databases');
  });
  it('binds database names literally and distinguishes missing databases', async () => {
    const database = "shop' OR 1=1 --";
    query.mockResolvedValueOnce(rows([]));
    await expect(service.getDatabaseInfo(database)).rejects.toThrow('not accessible');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SCHEMA_NAME = ?'), [database], undefined);
    expect(query.mock.calls[0]?.[0]).not.toContain(database);
  });
  it('returns table/view metadata and handles null statistics', async () => {
    query.mockResolvedValueOnce(rows([{ name: 'shop', characterSet: 'utf8mb4', collation: 'bin' }]));
    query.mockResolvedValueOnce(
      rows([
        {
          name: 'view',
          type: 'VIEW',
          engine: null,
          rowCount: null,
          dataLength: null,
          indexLength: null,
          comment: 'a|b\n<script>'
        }
      ])
    );
    const result = await service.getDatabaseInfo('shop');
    expect(result.tables[0]).toMatchObject({ rowCount: 0, dataLength: 0, indexLength: 0 });
    const markdown = formatDatabaseAsMarkdown(result.database, result.tables);
    expect(markdown).toContain('a&#124;b<br>&lt;script&gt;');
    expect(formatDatabaseAsMarkdown(result.database, [])).toContain('No tables');
  });
  it('binds every table query and groups composite indexes/foreign keys in order', async () => {
    query.mockResolvedValueOnce(
      rows([
        {
          database: 'Shop',
          name: 'child',
          type: 'BASE TABLE',
          engine: 'InnoDB',
          rowFormat: 'Dynamic',
          rowCount: '2',
          avgRowLength: 10,
          dataLength: 100,
          maxDataLength: 0,
          indexLength: 100,
          autoIncrement: 3,
          createTime: '2026-01-01',
          updateTime: '2026-01-02',
          comment: 'test'
        }
      ])
    );
    query.mockResolvedValueOnce(
      rows([
        {
          name: 'id',
          ordinalPosition: '1',
          dataType: 'int',
          columnType: 'int',
          isNullable: 'NO',
          columnKey: 'PRI',
          defaultValue: null,
          extra: 'auto_increment',
          comment: '',
          characterSet: null,
          collation: null
        }
      ])
    );
    query.mockResolvedValueOnce(
      rows([
        { name: 'composite', nonUnique: '0', columnName: 'a', indexType: 'BTREE', comment: '' },
        { name: 'composite', nonUnique: 0, columnName: 'b', indexType: 'BTREE', comment: '' },
        { name: 'expression', nonUnique: 1, columnName: null, indexType: 'BTREE', comment: '' }
      ])
    );
    query.mockResolvedValueOnce(
      rows([
        {
          name: 'fk',
          columnName: 'a',
          referencedDatabase: 'Other',
          referencedTable: 'parent',
          referencedColumn: 'x',
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        {
          name: 'fk',
          columnName: 'b',
          referencedDatabase: 'Other',
          referencedTable: 'parent',
          referencedColumn: 'y',
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        }
      ])
    );
    const schema = await service.getTableSchema('Shop', 'child');
    expect(schema.columns[0]).toMatchObject({ isNullable: false, ordinalPosition: 1 });
    expect(schema.indexes[0]).toMatchObject({ unique: true, columns: ['a', 'b'] });
    expect(schema.indexes[1]?.columns).toEqual(['(expression)']);
    expect(schema.foreignKeys[0]).toMatchObject({
      columns: ['a', 'b'],
      referencedTable: 'Other.parent',
      referencedColumns: ['x', 'y'],
      onUpdate: 'CASCADE'
    });
    for (const call of query.mock.calls) expect(call[1]).toEqual(['Shop', 'child']);
    const markdown = formatTableSchemaAsMarkdown(schema);
    expect(markdown).toContain('Other.parent(x, y)');
    expect(markdown).toContain('2026-01-01T00:00:00.000Z');
  });
  it('handles empty schemas and defaults for nullable statistics', async () => {
    query.mockResolvedValueOnce(
      rows([
        {
          database: 'shop',
          name: 'empty',
          type: 'VIEW',
          engine: null,
          rowFormat: null,
          rowCount: null,
          avgRowLength: null,
          dataLength: null,
          maxDataLength: null,
          indexLength: null,
          autoIncrement: null,
          createTime: null,
          updateTime: null,
          comment: ''
        }
      ])
    );
    query.mockResolvedValueOnce(rows([]));
    query.mockResolvedValueOnce(rows([]));
    query.mockResolvedValueOnce(rows([]));
    const schema = await service.getTableSchema('shop', 'empty');
    expect(schema.table.rowCount).toBe(0);
    expect(schema.indexes).toEqual([]);
    expect(formatTableSchemaAsMarkdown(schema)).toContain('N/A');
  });
  it('reports missing tables before querying dependent metadata', async () => {
    query.mockResolvedValueOnce(rows([]));
    await expect(service.getTableSchema('shop', 'missing')).rejects.toThrow('not accessible');
    expect(query).toHaveBeenCalledOnce();
  });
  it('rejects malformed internal metadata results', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 1 } as never, []]);
    await expect(service.listDatabases()).rejects.toThrow('Expected metadata rows');
  });
});
