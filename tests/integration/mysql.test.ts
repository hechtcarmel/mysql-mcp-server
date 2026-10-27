import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport as LegacyStdioTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MySQLClient } from '../../src/services/mysql-client.js';
import { QueryExecutor } from '../../src/services/query-executor.js';
import { MetadataService } from '../../src/services/metadata-service.js';
import { parseConfig } from '../../src/services/config-loader.js';
import { OperationMode } from '../../src/types.js';

// This suite sends only known-safe reads. Never run it as the real Mac trial:
// use scripts/local-smoke.mjs, which has an even smaller, fixed read-only scope.
const required = ['MYSQL_TEST_HOST', 'MYSQL_TEST_PORT', 'MYSQL_TEST_USER', 'MYSQL_TEST_PASSWORD'];
if (required.some(name => !process.env[name]))
  throw new Error('Set explicit MYSQL_TEST_HOST/PORT/USER/PASSWORD for a disposable read-only test target');
const serverEntry = process.env.MYSQL_TEST_SERVER_ENTRY ?? 'dist/index.js';
const env = {
  MYSQL_HOST: process.env.MYSQL_TEST_HOST!,
  MYSQL_PORT: process.env.MYSQL_TEST_PORT!,
  MYSQL_USER: process.env.MYSQL_TEST_USER!,
  MYSQL_PASSWORD: process.env.MYSQL_TEST_PASSWORD!,
  MYSQL_DATABASE: 'information_schema',
  MYSQL_POOL_SIZE: '2',
  MYSQL_MAX_ROWS: '3',
  MYSQL_ALLOW_WRITE: 'false'
};
let database: MySQLClient;
let executor: QueryExecutor;
const open: { close(): Promise<void> }[] = [];
beforeAll(() => {
  database = new MySQLClient(parseConfig(env));
  database.initialize();
  executor = new QueryExecutor(database, OperationMode.READ_ONLY);
});
afterAll(async () => {
  await Promise.all(open.map(item => item.close()));
  await database?.close();
});

async function server(modern = false) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry], env, stderr: 'pipe' });
  let logs = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    logs += chunk.toString();
  });
  const client = new Client(
    { name: 'integration', version: '1' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {}
  );
  await client.connect(transport);
  open.push(client);
  return { client, logs: () => logs };
}

describe('real database reads only', () => {
  it('retrieves metadata for existing system schemas without creating fixtures', async () => {
    const metadata = new MetadataService(database);
    expect(Array.isArray(await metadata.listDatabases())).toBe(true);
    const info = await metadata.getDatabaseInfo('information_schema');
    expect(info.database.name).toBe('information_schema');
    expect(info.tables.length).toBeGreaterThan(0);
    const schema = await metadata.getTableSchema('information_schema', 'TABLES');
    expect(schema.columns.map(column => column.name)).toContain('TABLE_NAME');
    expect(Array.isArray(schema.indexes)).toBe(true);
    expect(Array.isArray(schema.foreignKeys)).toBe(true);
  });
  it('retains duplicate aliases by column position', async () => {
    expect((await executor.executeQuery('SELECT 1 AS same, 2 AS same')).rows).toEqual([[1, 2]]);
  });
  it('retains exact BIGINT and DECIMAL expressions', async () => {
    expect(
      (
        await executor.executeQuery(
          "SELECT CAST('123456789012345678.90' AS DECIMAL(20,2)), CAST('18446744073709551615' AS UNSIGNED)"
        )
      ).rows
    ).toEqual([['123456789012345678.90', '18446744073709551615']]);
  });
  it('uses MYSQL_DATABASE for unqualified names', async () => {
    const result = await executor.executeQuery(
      "SELECT TABLE_NAME FROM TABLES WHERE TABLE_SCHEMA='information_schema' ORDER BY TABLE_NAME LIMIT 1"
    );
    expect(result.rows).toHaveLength(1);
  });
  it('enforces retained row limits on a bounded metadata query', async () => {
    const result = await executor.executeQuery(
      'SELECT TABLE_NAME FROM information_schema.TABLES ORDER BY TABLE_NAME LIMIT 5'
    );
    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
  it('supports CTEs, quoted delimiters, EXPLAIN, SHOW and DESCRIBE', async () => {
    expect((await executor.executeQuery('WITH c AS (SELECT 1 AS n) SELECT n FROM c')).rows).toEqual([[1]]);
    expect((await executor.executeQuery("SELECT ';--/* literal */' AS value; SELECT 2")).results).toHaveLength(2);
    expect((await executor.executeQuery('EXPLAIN SELECT 1')).rows?.length).toBeGreaterThan(0);
    expect((await executor.executeQuery("SHOW VARIABLES LIKE 'version' ")).rows).toHaveLength(1);
    expect((await executor.executeQuery('DESCRIBE information_schema.TABLES')).columns).toBeDefined();
  });
});

describe('read-only built CLI', () => {
  it('loads the existing environment-file variable names', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mysql-mcp-integration-env-'));
    const file = join(directory, 'mysql.env');
    // Test credentials are supplied explicitly; no production files are copied or modified.
    writeFileSync(
      file,
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      { mode: 0o600 }
    );
    const client = new Client({ name: 'env-file-client', version: '1' });
    open.push(client);
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [serverEntry],
          env: { MYSQL_ENV_FILE: file, MYSQL_ALLOW_WRITE: 'false' },
          stderr: 'pipe'
        })
      );
      const result = await client.callTool({
        name: 'mysql_query',
        arguments: { query: 'SELECT 1 AS connection_test', response_format: 'json' }
      });
      expect(result.structuredContent).toMatchObject({ rows: [[1]] });
      expect((await client.listTools()).tools[0]?.annotations?.readOnlyHint).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each([false, true])('serves legacy and July 2026 clients (modern=%s)', async modern => {
    const { client, logs } = await server(modern);
    if (modern) expect(client.getProtocolEra()).toBe('modern');
    expect((await client.listTools()).tools[0]).toMatchObject({
      name: 'mysql_query',
      annotations: { readOnlyHint: true, destructiveHint: false }
    });
    const result = await client.callTool({
      name: 'mysql_query',
      arguments: { query: 'SELECT 1 AS value', response_format: 'json' }
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ rows: [[1]], metadata: { rowCount: 1, truncated: false } });
    const content = result.content[0];
    if (content?.type === 'text') expect(JSON.parse(content.text)).toEqual(result.structuredContent);
    expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(2);
    expect((await client.readResource({ uri: 'mysql://information_schema/TABLES' })).contents[0]).toMatchObject({
      text: expect.stringContaining('TABLE_NAME')
    });
    expect(logs()).not.toContain(env.MYSQL_PASSWORD);
  });
  it('supports the v1 SDK client without changing the stdio configuration', async () => {
    const transport = new LegacyStdioTransport({ command: process.execPath, args: [serverEntry], env, stderr: 'pipe' });
    const client = new LegacyClient({ name: 'v1-client', version: '1' });
    open.push(client);
    await client.connect(transport);
    expect((await client.listTools()).tools[0]?.name).toBe('mysql_query');
    expect((await client.callTool({ name: 'mysql_query', arguments: { query: 'SELECT 1' } })).isError).not.toBe(true);
    expect((await client.listResources()).resources[0]?.uri).toBe('mysql://databases');
  });
  it.each(['eof', 'SIGTERM', 'SIGINT'])('exits cleanly after %s', async event => {
    const child = spawn(process.execPath, [serverEntry], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const output: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.stderr.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('server ready')) resolve();
        });
        child.once('exit', code => reject(new Error(`Exited before startup: ${code}`)));
      });
      const exited = once(child, 'exit');
      if (event === 'eof') child.stdin.end();
      else child.kill(event as NodeJS.Signals);
      const [code] = await exited;
      expect(code).toBe(0);
      expect(output.join('')).toBe('');
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });
});
