import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2';
import { MySQLClient } from '../src/services/mysql-client.js';
import { parseConfig } from '../src/services/config-loader.js';
import { QueryType } from '../src/types.js';

vi.mock('mysql2', () => ({ default: { createPool: vi.fn() } }));
const config = parseConfig({ MYSQL_HOST: 'test', MYSQL_USER: 'test', MYSQL_PASSWORD: 'test' });
let client: MySQLClient;
let active: EventEmitter | undefined;
const execute = vi.fn();
const promiseQuery = vi.fn();
const connection = {
  stream: new PassThrough(),
  promise: () => ({ execute, query: promiseQuery }),
  release: vi.fn(),
  destroy: vi.fn(() => active?.emit('error', new Error('Connection closed'))),
  query: vi.fn(() => {
    const emitter = new EventEmitter();
    active = emitter;
    queueMicrotask(() => {
      emitter.emit('fields', [
        { name: 'same', columnType: 3 },
        { name: 'same', columnType: 3 }
      ]);
      emitter.emit('result', [1, 2]);
      emitter.emit('result', [3, 4]);
      emitter.emit('end');
      active = undefined;
    });
    return emitter;
  })
};
const pool = {
  getConnection: vi.fn((callback: (error: Error | null, acquired: typeof connection) => void) =>
    callback(null, connection)
  ),
  end: vi.fn((callback: (error?: Error) => void) => callback())
};
beforeEach(() => {
  vi.clearAllMocks();
  active = undefined;
  connection.stream = new PassThrough();
  vi.mocked(mysql.createPool).mockReturnValue(pool as unknown as ReturnType<typeof mysql.createPool>);
  execute.mockResolvedValue([[{ value: 1 }], []]);
  promiseQuery.mockResolvedValue([[], []]);
  client = new MySQLClient({ ...config, queryTimeout: 30 });
  client.initialize();
});
afterEach(async () => {
  await client.close();
});
describe('pool lifecycle and bounded execution', () => {
  it.each([
    '!bang!',
    'hash#inside',
    '$dollar${literal}',
    "single'quote",
    'double"quote',
    String.raw`back\slash\n`,
    'at@colon:percent%',
    ' leading and trailing spaces ',
    'עברית🔒日本語'
  ])('passes password bytes unchanged to mysql2 for %s', async password => {
    await client.close();
    client = new MySQLClient({ ...config, password });
    client.initialize();
    expect(mysql.createPool).toHaveBeenLastCalledWith(expect.objectContaining({ password }));
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it('keeps multi-statements disabled and exact-number options enabled', () => {
    expect(mysql.createPool).toHaveBeenCalledWith(
      expect.objectContaining({ multipleStatements: false, bigNumberStrings: false, dateStrings: false })
    );
    client.initialize();
    expect(mysql.createPool).toHaveBeenCalledTimes(1);
  });
  it('passes metadata parameters through prepared execution', async () => {
    await client.executeQuery('SELECT ? AS name', ["x' OR 1=1 --"]);
    expect(execute).toHaveBeenCalledWith('SELECT ? AS name', ["x' OR 1=1 --"]);
    expect(connection.release).toHaveBeenCalledOnce();
  });
  it('preserves startup handshake errors before issuing the fixed read', async () => {
    const error = Object.assign(new Error('dummy-secret'), { code: 'HANDSHAKE_SSL_ERROR' });
    pool.getConnection.mockImplementationOnce(callback => callback(error, connection));
    await expect(client.testConnection()).rejects.toBe(error);
    expect(execute).not.toHaveBeenCalled();
    expect(connection.release).not.toHaveBeenCalled();
  });
  it('uses one connection and a read-only transaction for a whole batch', async () => {
    const results = await client.executeStatements([
      { sql: 'SELECT 1', queryType: QueryType.SELECT },
      { sql: 'SELECT 2', queryType: QueryType.SELECT }
    ]);
    expect(pool.getConnection).toHaveBeenCalledOnce();
    expect(promiseQuery.mock.calls).toEqual([['START TRANSACTION READ ONLY'], ['ROLLBACK']]);
    expect(results[0]?.rows).toEqual([
      [1, 2],
      [3, 4]
    ]);
    expect(connection.release).toHaveBeenCalledOnce();
  });
  it('caps retained rows and still drains the stream', async () => {
    await client.close();
    client = new MySQLClient({ ...config, maxRows: 1 });
    client.initialize();
    const [result] = await client.executeStatements([{ sql: 'SELECT 1', queryType: QueryType.SELECT }]);
    expect(result?.rows).toEqual([[1, 2]]);
    expect(result?.truncated).toBe(true);
    expect(connection.release).toHaveBeenCalledOnce();
  });
  it('destroys a failed connection rather than leaking transaction state', async () => {
    execute.mockRejectedValueOnce(new Error('driver failed'));
    await expect(client.executeQuery('SELECT 1')).rejects.toThrow('driver failed');
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.stream.destroyed).toBe(true);
    expect(connection.release).not.toHaveBeenCalled();
  });
  it('enforces the deadline while waiting for a pooled connection and destroys a late acquisition', async () => {
    let acquire: ((error: Error | null, acquired: typeof connection) => void) | undefined;
    pool.getConnection.mockImplementationOnce(callback => {
      acquire = callback;
    });
    await expect(client.executeQuery('SELECT 1')).rejects.toThrow('timeout');
    acquire?.(null, connection);
    await Promise.resolve();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });
  it('cancels in-flight work and removes the connection from service', async () => {
    execute.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = client.executeQuery('SELECT 1', [], controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(connection.destroy).toHaveBeenCalledOnce();
  });
  it('rejects an already-cancelled request before acquiring a connection', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(client.executeQuery('SELECT 1', [], controller.signal)).rejects.toThrow();
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
  it('rejects active requests promptly on shutdown without waiting for a query deadline', async () => {
    execute.mockImplementationOnce(() => new Promise(() => {}));
    const pending = client.executeQuery('SELECT 1');
    const rejected = expect(pending).rejects.toThrow('shutting down');
    await Promise.resolve();
    await client.close();
    await rejected;
    expect(connection.stream.destroyed).toBe(true);
    expect(connection.release).not.toHaveBeenCalled();
  });
  it('closes idempotently and rejects queries after shutdown', async () => {
    await Promise.all([client.close(), client.close()]);
    expect(pool.end).toHaveBeenCalledOnce();
    await expect(client.executeQuery('SELECT 1')).rejects.toThrow('not running');
  });
});
