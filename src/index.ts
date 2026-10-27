#!/usr/bin/env node
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './services/config-loader.js';
import { MySQLClient } from './services/mysql-client.js';
import { QueryExecutor } from './services/query-executor.js';
import { MetadataService } from './services/metadata-service.js';
import { createServer } from './server.js';
import { logStartup, type StartupStage } from './utils/startup-diagnostics.js';
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
  let startupStage: StartupStage = 'configuration';
  try {
    logStartup(startupStage, 'started');
    const config = loadConfig();
    logStartup(startupStage, 'ready');
    startupStage = 'database-pool';
    logStartup(startupStage, 'started');
    client = new MySQLClient(config);
    client.initialize();
    logStartup(startupStage, 'ready');
    startupStage = 'database-connect';
    logStartup(startupStage, 'started');
    await client.testConnection();
    logStartup(startupStage, 'ready');
    if (shutdownPromise) return;
    const executor = new QueryExecutor(client, config.operationMode);
    const metadata = new MetadataService(client);
    startupStage = 'mcp-transport';
    logStartup(startupStage, 'started');
    const transport = new StdioServerTransport();
    handle = serveStdio(
      () => {
        const server = createServer(config, executor, metadata);
        server.server.onclose = stop;
        return server;
      },
      {
        transport,
        onerror: error => {
          logStartup('mcp-transport', 'failed', error);
          logError('MCP transport error', error);
        }
      }
    );
    // EOF also closes an uninitialized transport, before a server instance exists.
    process.stdin.once('end', stop);
    logStartup(startupStage, 'ready');
    logInfo(`MySQL MCP server ready (${config.operationMode})`);
  } catch (error) {
    logStartup(startupStage, 'failed', error);
    // Config errors are generated locally and contain variable names, never values.
    if (client) logError('Failed to start MySQL MCP server', error);
    else logError(error instanceof Error ? error.message : 'Invalid configuration');
    process.exitCode = 1;
    await shutdown();
  }
}
void main();
