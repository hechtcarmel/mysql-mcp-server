import connectionCategories from './startup-error-codes.json' with { type: 'json' };
/** Machine-readable startup evidence. Never includes host, paths, values or raw errors. */
export type StartupStage = 'configuration' | 'database-pool' | 'database-connect' | 'mcp-transport';
export class ConfigurationError extends Error {
  constructor(
    readonly category: string,
    message: string
  ) {
    super(message);
  }
}
const configurationCategories = new Set([
  'configuration-file-unavailable',
  'required-configuration-missing',
  'configuration-boolean-invalid',
  'configuration-number-invalid',
  'tls-configuration-incomplete',
  'tls-file-unavailable',
  'cleartext-auth-requires-verified-tls',
  'cleartext-auth-requires-dns-host'
]);
/** Values are deliberately fixed: no error names, code strings or messages pass through. */
export interface StartupErrorSummary {
  errorClass: 'AggregateError' | 'TypeError' | 'RangeError' | 'SyntaxError' | 'Error' | 'NonError';
  code: string | null;
  codeStatus: 'recognized' | 'missing' | 'unrecognized';
}
export interface StartupErrorDetails extends StartupErrorSummary {
  causes: StartupErrorSummary[];
  truncated: boolean;
}
function property(error: unknown, key: string): unknown {
  try {
    return error && typeof error === 'object' ? Reflect.get(error, key) : undefined;
  } catch {
    return undefined;
  }
}
function summary(error: unknown): StartupErrorSummary {
  const code = property(error, 'code');
  const recognized = typeof code === 'string' && Object.hasOwn(connectionCategories, code);
  return {
    errorClass:
      error instanceof AggregateError
        ? 'AggregateError'
        : error instanceof TypeError
          ? 'TypeError'
          : error instanceof RangeError
            ? 'RangeError'
            : error instanceof SyntaxError
              ? 'SyntaxError'
              : error instanceof Error
                ? 'Error'
                : 'NonError',
    code: recognized ? code : null,
    codeStatus: recognized ? 'recognized' : code === undefined || code === null ? 'missing' : 'unrecognized'
  };
}
export function startupErrorDetails(error: unknown): StartupErrorDetails {
  const result: StartupErrorDetails = { ...summary(error), causes: [], truncated: false };
  const queue = [{ error, depth: 0 }];
  const seen = new Set<unknown>();
  // At most eight distinct nodes and three levels, even for cycles/aggregates.
  while (queue.length && seen.size < 8) {
    const node = queue.shift()!;
    if (seen.has(node.error)) continue;
    seen.add(node.error);
    if (node.depth) result.causes.push(summary(node.error));
    const cause = property(node.error, 'cause');
    const errors = property(node.error, 'errors');
    const children = [
      ...(cause === undefined ? [] : [cause]),
      ...(Array.isArray(errors) ? (errors as unknown[]).slice(0, 8) : [])
    ];
    if (Array.isArray(errors) && errors.length > 8) result.truncated = true;
    if (node.depth >= 2) {
      if (children.length) result.truncated = true;
      continue;
    }
    for (const child of children) if (!seen.has(child)) queue.push({ error: child, depth: node.depth + 1 });
  }
  if (queue.length) result.truncated = true;
  return result;
}
export function startupCategory(stage: StartupStage, error: unknown): string {
  if (error instanceof ConfigurationError && configurationCategories.has(error.category)) return error.category;
  if (stage === 'configuration') return 'configuration-parse-failed';
  if (stage === 'database-connect' || stage === 'database-pool') {
    const details = startupErrorDetails(error);
    const evidence = [details, ...details.causes];
    const policy = evidence.find(item => item.code?.startsWith('MYSQL_CLEARTEXT_'));
    if (policy?.code) return connectionCategories[policy.code as keyof typeof connectionCategories];
    for (const item of evidence) {
      if (item.code) return connectionCategories[item.code as keyof typeof connectionCategories];
    }
  }
  return stage === 'mcp-transport' ? 'mcp-server-startup-failed' : 'server-startup-failed';
}
export function logStartup(stage: StartupStage, status: 'started' | 'ready' | 'failed', error?: unknown): void {
  console.error(
    JSON.stringify({
      level: status === 'failed' ? 'error' : 'info',
      event: 'mysql-startup',
      stage,
      status,
      ...(status === 'failed' && { category: startupCategory(stage, error), error: startupErrorDetails(error) })
    })
  );
}
