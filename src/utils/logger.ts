import { createHash } from 'node:crypto';
import { startupErrorDetails } from './startup-diagnostics.js';
import { type OperationMode, type QueryType } from '../types.js';

export function logInfo(message: string): void {
  console.error(JSON.stringify({ level: 'info', time: new Date().toISOString(), message }));
}
export function logError(message: string, error?: unknown): void {
  // Driver error objects can contain SQL, values, and credentials. Log only an error code.
  const code = startupErrorDetails(error).code ?? undefined;
  console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), message, code }));
}
export function logQuery(query: string, mode: OperationMode, allowed: boolean, queryType?: QueryType): void {
  console.error(
    JSON.stringify({
      level: 'info',
      event: 'query_validation',
      mode,
      allowed,
      queryType,
      fingerprint: createHash('sha256').update(query).digest('hex').slice(0, 16),
      length: query.length
    })
  );
}
