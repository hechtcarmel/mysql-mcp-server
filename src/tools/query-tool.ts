import type { CallToolResult } from '@modelcontextprotocol/server';
import { QueryInputSchema } from '../schemas/tool-schemas.js';
import { QueryExecutor } from '../services/query-executor.js';
import { formatQueryResponse } from '../utils/formatters.js';
import { handleQueryError } from '../utils/error-handlers.js';
import { OperationMode } from '../types.js';
import { CHARACTER_LIMIT, MAX_STATEMENTS } from '../constants.js';

export function queryToolDescription(mode: OperationMode, maxRows: number): string {
  return (
    'Query MySQL data or inspect query plans; prefer schema resources for tables, columns and relationships. ' +
    `Mode: ${mode}. SELECT, SHOW, DESCRIBE and EXPLAIN are supported. ` +
    (mode === OperationMode.READ_ONLY
      ? 'Writes are disabled; reads run in a MySQL READ ONLY transaction. '
      : 'INSERT, UPDATE, DELETE and REPLACE are enabled. Explicit transactions must start and finish in one call. ') +
    `Up to ${MAX_STATEMENTS} validated statements run sequentially on one connection. ` +
    'DDL, administrative SQL, file access, variable assignments, locking reads, EXPLAIN ANALYZE and selected side-effecting built-ins are blocked. ' +
    `Return at most ${maxRows} retained rows per call; text and structured output each have a ${CHARACTER_LIMIT}-character budget. ` +
    'Use LIMIT to bound database work; metadata.truncated reports omitted output. Input/SQL failures set isError. ' +
    (mode === OperationMode.WRITE_ENABLED
      ? 'A timeout or cancellation does not prove a write failed; verify before retrying. '
      : '') +
    'SQL is never retried automatically. Account grants bound access; validation is not a routine/UDF sandbox.'
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
