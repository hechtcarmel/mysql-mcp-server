/**
 * Database resource handlers
 */

import { MetadataService } from '../services/metadata-service.js';
import { formatDatabaseListAsMarkdown, formatDatabaseAsMarkdown } from '../utils/formatters.js';

/**
 * Handle database list resource (mysql://databases)
 */
export async function handleDatabaseListResource(metadataService: MetadataService): Promise<string> {
  try {
    const databases = await metadataService.listDatabases();
    return formatDatabaseListAsMarkdown(databases);
  } catch (error) {
    if (error instanceof Error) {
      return `**Error retrieving database list**\n\n${error.message}\n`;
    }
    return `**Error retrieving database list**\n\n${String(error)}\n`;
  }
}

/**
 * Handle single database resource (mysql://{database})
 */
export async function handleDatabaseResource(metadataService: MetadataService, database: string): Promise<string> {
  try {
    const { database: dbInfo, tables } = await metadataService.getDatabaseInfo(database);
    return formatDatabaseAsMarkdown(dbInfo, tables);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('does not exist')) {
        return (
          `**Error: Database not found**\n\n` +
          `Database '${database}' does not exist or is not accessible.\n\n` +
          `**Suggestions:**\n` +
          `- Verify the database name is spelled correctly\n` +
          `- Use the mysql://databases resource to see available databases\n` +
          `- Check that you have permissions to access this database\n`
        );
      }
      return `**Error retrieving database information**\n\n${error.message}\n`;
    }
    return `**Error retrieving database information**\n\n${String(error)}\n`;
  }
}
