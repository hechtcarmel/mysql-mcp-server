#!/usr/bin/env node

/**
 * MySQL MCP Server
 * Main entry point for the MCP server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './services/config-loader.js';
import { MySQLClient } from './services/mysql-client.js';
import { QueryExecutor } from './services/query-executor.js';
import { MetadataService } from './services/metadata-service.js';
import { logInfo, logError, logServerStartup, logPoolConfig, logSSLConfig } from './utils/logger.js';

/**
 * Main server initialization
 */
async function main(): Promise<void> {
  try {
    // Load configuration
    logInfo('Loading configuration...');
    const config = loadConfig();

    // Log startup information
    logServerStartup(config.operationMode, config.host, config.port);
    logPoolConfig(config.poolSize, config.connectionTimeout, config.queryTimeout);
    logSSLConfig(!!config.ssl);

    // Initialize MySQL client
    logInfo('Initializing MySQL client...');
    const mysqlClient = new MySQLClient(config);
    await mysqlClient.initialize();

    // Test database connection
    logInfo('Testing database connection...');
    const connectionOk = await mysqlClient.testConnection();
    if (!connectionOk) {
      throw new Error('Database connection test failed');
    }

    // Initialize services
    const queryExecutor = new QueryExecutor(mysqlClient, config.operationMode);
    const metadataService = new MetadataService(mysqlClient);

    // Create MCP server
    const server = new Server(
      {
        name: 'mysql-mcp-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        }
      }
    );

    // Register mysql_query tool
    const { createQueryTool, handleQueryTool } = await import('./tools/query-tool.js');
    const queryTool = createQueryTool(queryExecutor, config.operationMode, config.queryTimeout);

    server.setRequestHandler('tools/list' as any, async () => {
      return {
        tools: [queryTool]
      };
    });

    server.setRequestHandler('tools/call' as any, async (request: any) => {
      if (request.params.name === 'mysql_query') {
        return await handleQueryTool(request.params.arguments, queryExecutor, config.queryTimeout);
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    });

    logInfo('✓ Registered tool: mysql_query');

    // Register resources
    const { handleDatabaseListResource, handleDatabaseResource } = await import('./resources/database-resource.js');
    const { handleTableResource } = await import('./resources/table-resource.js');

    server.setRequestHandler('resources/list' as any, async () => {
      try {
        const databases = await metadataService.listDatabases();
        const resources = [
          {
            uri: 'mysql://databases',
            name: 'All Databases',
            description: 'List all accessible databases with their character sets and table counts',
            mimeType: 'text/markdown'
          }
        ];

        // Add resources for each database
        for (const db of databases) {
          resources.push({
            uri: `mysql://${db.name}`,
            name: `Database: ${db.name}`,
            description: `Tables and metadata for ${db.name} database (${db.tableCount} tables)`,
            mimeType: 'text/markdown'
          });
        }

        return { resources };
      } catch (error) {
        logError('Error listing resources', error);
        return { resources: [] };
      }
    });

    server.setRequestHandler('resources/read' as any, async (request: any) => {
      const uri = request.params.uri;

      try {
        // Parse the URI
        if (!uri.startsWith('mysql://')) {
          throw new Error(`Invalid resource URI: ${uri}`);
        }

        const path = uri.substring('mysql://'.length);
        const parts = path.split('/');

        let content: string;

        if (path === 'databases') {
          // List all databases
          content = await handleDatabaseListResource(metadataService);
        } else if (parts.length === 1) {
          // Single database
          const database = parts[0];
          content = await handleDatabaseResource(metadataService, database);
        } else if (parts.length === 2) {
          // Table schema
          const [database, table] = parts;
          content = await handleTableResource(metadataService, database, table);
        } else {
          throw new Error(`Invalid resource URI format: ${uri}`);
        }

        return {
          contents: [
            {
              uri,
              mimeType: 'text/markdown',
              text: content
            }
          ]
        };
      } catch (error) {
        logError(`Error reading resource ${uri}`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri,
              mimeType: 'text/markdown',
              text: `**Error**\n\n${errorMessage}\n`
            }
          ]
        };
      }
    });

    logInfo('✓ Registered MCP resources (databases, tables)');

    // Set up stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logInfo('✓ MySQL MCP Server started successfully');
    logInfo('Server is ready to accept requests via stdio');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logInfo('Received SIGINT, shutting down gracefully...');
      await mysqlClient.close();
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logInfo('Received SIGTERM, shutting down gracefully...');
      await mysqlClient.close();
      await server.close();
      process.exit(0);
    });

  } catch (error) {
    logError('Failed to start MySQL MCP Server', error);
    process.exit(1);
  }
}

// Start the server
main();
