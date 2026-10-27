#!/usr/bin/env node
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './services/config-loader.js';
import { MySQLClient } from './services/mysql-client.js';
import { QueryExecutor } from './services/query-executor.js';
import { MetadataService } from './services/metadata-service.js';
import { createServer } from './server.js';
import { logInfo, logError } from './utils/logger.js';

async function main(): Promise<void> {
  let client: MySQLClient | undefined;
  let handle: ReturnType<typeof serveStdio> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= Promise.resolve().then(async () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      const results = await Promise.allSettled([handle?.close(), client?.close()]);
      if (results.some(result => result.status === 'rejected')) {
        process.exitCode = 1;
        logError('Server cleanup failed');
      }
    });
    return shutdownPromise;
  };
  const stop = (): void => {
    void shutdown();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const config = loadConfig();
    client = new MySQLClient(config);
    client.initialize();
    await client.testConnection();
    if (shutdownPromise) return;
    const executor = new QueryExecutor(client, config.operationMode);
    const metadata = new MetadataService(client);
    const transport = new StdioServerTransport();
    handle = serveStdio(
      () => {
        const server = createServer(config, executor, metadata);
        server.server.onclose = stop;
        return server;
      },
      { transport, onerror: error => logError('MCP transport error', error) }
    );
    // EOF also closes an uninitialized transport, before a server instance exists.
    process.stdin.once('end', stop);
    logInfo(`MySQL MCP server ready (${config.operationMode})`);
  } catch (error) {
    // Config errors are generated locally and contain variable names, never values.
    if (client) logError('Failed to start MySQL MCP server', error);
    else logError(error instanceof Error ? error.message : 'Invalid configuration');
    process.exitCode = 1;
    await shutdown();
  }
}
void main();
