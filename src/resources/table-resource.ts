import { MetadataService } from '../services/metadata-service.js';
import { formatTableSchemaAsMarkdown } from '../utils/formatters.js';

export async function handleTableResource(
  service: MetadataService,
  database: string,
  table: string,
  signal?: AbortSignal
): Promise<string> {
  return formatTableSchemaAsMarkdown(await service.getTableSchema(database, table, signal));
}
