import { MetadataService } from '../services/metadata-service.js';
import { formatDatabaseListAsMarkdown, formatDatabaseAsMarkdown } from '../utils/formatters.js';

export async function handleDatabaseListResource(service: MetadataService, signal?: AbortSignal): Promise<string> {
  return formatDatabaseListAsMarkdown(await service.listDatabases(signal));
}
export async function handleDatabaseResource(
  service: MetadataService,
  database: string,
  signal?: AbortSignal
): Promise<string> {
  const result = await service.getDatabaseInfo(database, signal);
  return formatDatabaseAsMarkdown(result.database, result.tables);
}
