/**
 * Table resource handlers
 */

import { MetadataService } from '../services/metadata-service.js';
import { formatTableSchemaAsMarkdown } from '../utils/formatters.js';

/**
 * Handle table schema resource (mysql://{database}/{table})
 */
export async function handleTableResource(
  metadataService: MetadataService,
  database: string,
  table: string
): Promise<string> {
  try {
    const schema = await metadataService.getTableSchema(database, table);
    return formatTableSchemaAsMarkdown(schema);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('does not exist')) {
        return (
          `**Error: Table not found**\n\n` +
          `Table '${database}.${table}' does not exist or is not accessible.\n\n` +
          `**Suggestions:**\n` +
          `- Verify the table name is spelled correctly\n` +
          `- Use the mysql://${database} resource to see available tables in this database\n` +
          `- Check that you have permissions to access this table\n` +
          `- Ensure the database '${database}' exists\n`
        );
      }
      return `**Error retrieving table schema**\n\n${error.message}\n`;
    }
    return `**Error retrieving table schema**\n\n${String(error)}\n`;
  }
}
