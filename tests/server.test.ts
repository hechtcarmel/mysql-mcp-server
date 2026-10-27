import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { parseConfig } from '../src/services/config-loader.js';
import { MySQLClient } from '../src/services/mysql-client.js';
import { MetadataService, MetadataNotFoundError } from '../src/services/metadata-service.js';
import { QueryExecutor } from '../src/services/query-executor.js';
import { createServer } from '../src/server.js';
import { OperationMode } from '../src/types.js';
import { handleQueryTool } from '../src/tools/query-tool.js';
import { handleQueryError } from '../src/utils/error-handlers.js';
import { logError, logQuery } from '../src/utils/logger.js';

const config = parseConfig({ MYSQL_HOST: 'test', MYSQL_USER: 'test', MYSQL_PASSWORD: 'super-secret' });
const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map(item => item.close()));
  vi.restoreAllMocks();
});
async function connected(mode = OperationMode.READ_ONLY, maxRows = config.maxRows) {
  const database = new MySQLClient({ ...config, operationMode: mode, maxRows });
  const metadata = new MetadataService(database);
  const executor = new QueryExecutor(database, mode);
  vi.spyOn(metadata, 'listDatabases').mockResolvedValue([
    { name: 'Mixed-Case', tableCount: 1, defaultCharacterSet: 'utf8mb4', defaultCollation: 'utf8mb4_bin' }
  ]);
  const server = createServer({ ...config, operationMode: mode, maxRows }, executor, metadata);
  const client = new Client({ name: 'test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  open.push(client, server);
  return { client, server, executor, metadata, database };
}
describe('MCP contracts and compatibility', () => {
  it.each([OperationMode.READ_ONLY, OperationMode.WRITE_ENABLED])(
    'advertises truthful annotations in %s',
    async mode => {
      const { client } = await connected(mode);
      const { tools } = await client.listTools();
      expect(tools.map(tool => tool.name)).toEqual(['mysql_query']);
      expect(tools[0]?.annotations).toMatchObject({
        readOnlyHint: mode === OperationMode.READ_ONLY,
        destructiveHint: mode === OperationMode.WRITE_ENABLED,
        idempotentHint: false,
        openWorldHint: true
      });
      expect(tools[0]?.inputSchema.properties?.query).toMatchObject({ minLength: 1, maxLength: 10000 });
      expect(tools[0]?.outputSchema).toBeDefined();
    }
  );
  it('advertises configured limits, safe input guidance and a concrete batch output schema', async () => {
    const { client } = await connected(OperationMode.READ_ONLY, 37);
    const tool = (await client.listTools()).tools[0]!;
    expect(tool.description).toContain('37 retained rows');
    expect(tool.description).toContain('25000-character');
    expect(tool.description).toContain('50 validated statements');
    expect(tool.description).toContain('READ ONLY transaction');
    expect(tool.description).toContain('EXPLAIN ANALYZE');
    expect(tool.description).toContain('isError');
    expect(tool.description!.length).toBeLessThan(1400);
    expect(tool.inputSchema.properties?.query).toMatchObject({
      description: expect.stringContaining('unqualified names use MYSQL_DATABASE'),
      examples: [expect.stringContaining('LIMIT 10')]
    });
    expect(tool.inputSchema.properties?.response_format).toMatchObject({
      default: 'markdown',
      description: expect.stringContaining('structuredContent')
    });
    expect(tool.outputSchema).toMatchObject({
      properties: {
        results: {
          type: 'array',
          items: expect.objectContaining({ type: 'object' })
        }
      }
    });
    expect(JSON.stringify(tool).length).toBeLessThan(9000);
  });
  it('keeps default Markdown and legacy JSON text alongside structured content', async () => {
    const { client, executor } = await connected();
    vi.spyOn(executor, 'executeQuery').mockResolvedValue({
      columns: [{ name: 'x', type: 'LONG' }],
      rows: [[1]],
      rowCount: 1,
      executionTime: 1
    });
    const markdown = await client.callTool({ name: 'mysql_query', arguments: { query: 'SELECT 1' } });
    expect(markdown.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('| x |') })
    ]);
    const json = await client.callTool({
      name: 'mysql_query',
      arguments: { query: 'SELECT 1', response_format: 'json' }
    });
    expect(json.content[0]).toMatchObject({ text: JSON.stringify(json.structuredContent, null, 2) });
  });
  it('validates concrete per-statement structured output through the MCP client', async () => {
    const { client, executor } = await connected();
    const first = { columns: [{ name: 'x', type: 'LONG' }], rows: [[1]], rowCount: 1, executionTime: 1 };
    vi.spyOn(executor, 'executeQuery').mockResolvedValue({ ...first, results: [first, { ...first, rows: [[2]] }] });
    const result = await client.callTool({
      name: 'mysql_query',
      arguments: { query: 'SELECT 1; SELECT 2', response_format: 'json' }
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      rows: [[1]],
      results: [
        { rows: [[1]], metadata: { rowCount: 1 } },
        { rows: [[2]], metadata: { rowCount: 1 } }
      ]
    });
  });
  it('marks SQL policy failures as tool errors', async () => {
    const { client } = await connected();
    const result = await client.callTool({ name: 'mysql_query', arguments: { query: 'DELETE FROM shop.orders' } });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('blocked') });
  });
  it('reports invalid arguments before attempting execution', async () => {
    const { client, executor } = await connected();
    const execute = vi.spyOn(executor, 'executeQuery');
    const result = await client.callTool({ name: 'mysql_query', arguments: { query: '', extra: true } });
    expect(result.isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects unknown tools', async () => {
    const { client } = await connected();
    await expect(client.callTool({ name: 'missing', arguments: {} })).rejects.toThrow();
  });
  it('retains database resources and advertises resource templates', async () => {
    const { client } = await connected();
    expect((await client.listResources()).resources.map(resource => resource.uri)).toEqual([
      'mysql://databases',
      'mysql://Mixed-Case'
    ]);
    expect((await client.listResourceTemplates()).resourceTemplates.map(template => template.uriTemplate)).toEqual([
      'mysql://{database}',
      'mysql://{database}/{table}'
    ]);
  });
  it('passes decoded, case-sensitive database names as parameters', async () => {
    const { client, metadata } = await connected();
    const info = vi
      .spyOn(metadata, 'getDatabaseInfo')
      .mockResolvedValue({ database: { name: 'Mixed-Case', characterSet: 'utf8mb4', collation: 'bin' }, tables: [] });
    await client.readResource({ uri: 'mysql://Mixed-Case' });
    expect(info).toHaveBeenCalledWith('Mixed-Case', expect.any(AbortSignal));
  });
  it('paginates resource discovery and rejects malformed cursors', async () => {
    const { client, metadata } = await connected();
    vi.mocked(metadata.listDatabases).mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => ({
        name: `db${i}`,
        tableCount: 0,
        defaultCharacterSet: 'utf8mb4',
        defaultCollation: 'bin'
      }))
    );
    const first = await client.request({ method: 'resources/list', params: {} });
    expect(first.resources).toHaveLength(100);
    expect(first.nextCursor).toBe('100');
    expect(
      (await client.request({ method: 'resources/list', params: { cursor: first.nextCursor } })).resources
    ).toHaveLength(51);
    await expect(client.listResources({ cursor: '-1' })).rejects.toThrow('cursor');
  });
  it('uses protocol errors for missing resources instead of successful error text', async () => {
    const { client, metadata } = await connected();
    vi.spyOn(metadata, 'getTableSchema').mockRejectedValue(new MetadataNotFoundError('Table not found'));
    await expect(client.readResource({ uri: 'mysql://shop/missing' })).rejects.toThrow('Table not found');
    await expect(client.readResource({ uri: 'mysql://shop/too/many/parts' })).rejects.toThrow();
  });
  it('does not turn metadata outages into empty resource lists', async () => {
    const { client, metadata } = await connected();
    vi.mocked(metadata.listDatabases).mockRejectedValue(new Error('connection failed'));
    await expect(client.listResources()).rejects.toThrow('Could not list');
  });
  it('keeps validation errors compatible for direct handlers', async () => {
    const { executor } = await connected();
    expect((await handleQueryTool({ query: 1 }, executor, 30000)).isError).toBe(true);
  });
  it('does not log SQL values or raw driver errors', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    logQuery("INSERT INTO db.t VALUES ('super-secret')", OperationMode.WRITE_ENABLED, true);
    logError('Query failed', { code: 'ER_PARSE_ERROR', sql: 'super-secret', password: 'super-secret' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('super-secret');
    expect(
      handleQueryError({ code: 'ER_UNKNOWN', sql: 'super-secret', sqlMessage: 'super-secret' }, 30000)
    ).not.toContain('super-secret');
  });
});
