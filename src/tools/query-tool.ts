import type { CallToolResult } from '@modelcontextprotocol/server';
import { QueryInputSchema } from '../schemas/tool-schemas.js';
import { QueryExecutor } from '../services/query-executor.js';
import { formatQueryResponse } from '../utils/formatters.js';
import { handleQueryError } from '../utils/error-handlers.js';
import { OperationMode } from '../types.js';

export function queryToolDescription(mode: OperationMode): string {
  return (
    `Execute MySQL SQL in ${mode} mode. Prefer fully qualified database.table names. ` +
    'Use schema resources before querying and LIMIT for exploratory queries. ' +
    'SELECT, SHOW, DESCRIBE and EXPLAIN are supported. ' +
    (mode === OperationMode.WRITE_ENABLED
      ? 'INSERT, UPDATE, DELETE, REPLACE and complete transactions in a single call are enabled. '
      : 'Writes are disabled by default. ') +
    'DDL, administrative SQL, file operations, session-variable assignments and locking reads are blocked. ' +
    'Multiple statements run sequentially on one connection; transaction boundaries must be in the same call. ' +
    'Results have row and character limits. A write timeout or cancellation has an uncertain outcome; verify before retrying.'
  );
}

export async function handleQueryTool(
  args: unknown,
  executor: QueryExecutor,
  timeout: number,
  signal?: AbortSignal
): Promise<CallToolResult> {
  try {
    const input = QueryInputSchema.parse(args);
    const result = await executor.executeQuery(input.query, signal);
    const formatted = formatQueryResponse(result, input.response_format);
    return { content: [{ type: 'text', text: formatted.text }], structuredContent: formatted.structuredContent };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: handleQueryError(error, timeout) }] };
  }
}
