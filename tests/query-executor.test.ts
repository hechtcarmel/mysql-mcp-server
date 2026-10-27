import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldPacket, ResultSetHeader } from 'mysql2';
import { MySQLClient } from '../src/services/mysql-client.js';
import { QueryExecutor } from '../src/services/query-executor.js';
import { parseConfig } from '../src/services/config-loader.js';
import { OperationMode } from '../src/types.js';

const config = parseConfig({ MYSQL_HOST: 'test', MYSQL_USER: 'test', MYSQL_PASSWORD: 'test' });
const database = new MySQLClient(config);
const execute = vi.spyOn(database, 'executeStatements');
const executor = new QueryExecutor(database, OperationMode.READ_ONLY);
beforeEach(() => {
  execute.mockReset();
});
describe('query execution boundary', () => {
  it('validates the entire batch before touching the database', async () => {
    await expect(executor.executeQuery('SELECT 1; DELETE FROM db.t')).rejects.toThrow('blocked');
    expect(execute).not.toHaveBeenCalled();
  });
  it('preserves duplicate column positions and type names including unknown types', async () => {
    execute.mockResolvedValueOnce([
      {
        rows: [[1, 2]],
        fields: [
          { name: 'same', columnType: 3 },
          { name: 'same', columnType: 999 }
        ] as FieldPacket[],
        truncated: true
      }
    ]);
    const result = await executor.executeQuery('SELECT 1 AS same, 2 AS same');
    expect(result).toMatchObject({
      rows: [[1, 2]],
      columns: [
        { name: 'same', type: 'LONG' },
        { name: 'same', type: 'UNKNOWN(999)' }
      ],
      truncated: true,
      rowCount: 1
    });
  });
  it('preserves DML metadata and batch statement order', async () => {
    const writer = new QueryExecutor(database, OperationMode.WRITE_ENABLED);
    execute.mockResolvedValueOnce([
      { rows: { affectedRows: 2, insertId: 3, changedRows: 1 } as ResultSetHeader, fields: [], truncated: false },
      { rows: [[4]], fields: [{ name: 'id', columnType: 3 }] as FieldPacket[], truncated: false }
    ]);
    const result = await writer.executeQuery('INSERT INTO db.t VALUES (1); SELECT 4');
    expect(result).toMatchObject({ affectedRows: 2, insertId: 3, changedRows: 1, rowCount: 2 });
    expect(result.results?.[1]?.rows).toEqual([[4]]);
  });
  it('passes cancellation through and propagates driver failures without rewriting them', async () => {
    const signal = new AbortController().signal;
    const error = Object.assign(new Error('denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
    execute.mockRejectedValueOnce(error);
    await expect(executor.executeQuery('SELECT 1', signal)).rejects.toBe(error);
    expect(execute).toHaveBeenCalledWith(expect.any(Array), signal);
  });
});
