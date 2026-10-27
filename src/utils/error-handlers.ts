import { ZodError } from 'zod';

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

export function isTimeoutError(error: unknown): boolean {
  return (
    ['ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_QUERY_TIMEOUT', 'ER_STATEMENT_TIMEOUT'].includes(
      errorCode(error) ?? ''
    ) ||
    (error instanceof Error && /timeout|timed out/i.test(error.message))
  );
}

const mysqlErrors: Record<string, string> = {
  ER_NO_SUCH_TABLE:
    'Table does not exist or is not accessible. Inspect mysql://{database} and use database.table names.',
  ER_BAD_DB_ERROR: 'Database does not exist or is not accessible. Inspect mysql://databases.',
  ER_ACCESS_DENIED_ERROR: 'Access denied. Check MySQL credentials and grants.',
  ER_TABLEACCESS_DENIED_ERROR: 'Access denied. Ask the database administrator to check table privileges.',
  ER_DBACCESS_DENIED_ERROR: 'Access denied. Ask the database administrator to check database privileges.',
  ER_PARSE_ERROR: 'SQL syntax error. Check the syntax, identifiers and MySQL version.',
  ER_SYNTAX_ERROR: 'SQL syntax error. Check the syntax, identifiers and MySQL version.',
  ER_DUP_ENTRY: 'Duplicate entry. Check primary and unique keys before retrying.',
  ER_NO_REFERENCED_ROW: 'Foreign key constraint violation. The referenced parent row must exist.',
  ER_NO_REFERENCED_ROW_2: 'Foreign key constraint violation. The referenced parent row must exist.',
  ER_ROW_IS_REFERENCED: 'Foreign key constraint violation. Child rows still reference this row.',
  ER_ROW_IS_REFERENCED_2: 'Foreign key constraint violation. Child rows still reference this row.',
  ER_LOCK_WAIT_TIMEOUT: 'Lock wait timeout. Check for blocking transactions before retrying.',
  ER_LOCK_DEADLOCK: 'Deadlock detected. The transaction was rolled back; verify state before retrying.',
  ER_TOO_MANY_CONNECTIONS: 'Too many MySQL connections. Check pool limits and database capacity.',
  ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION: 'MySQL blocked a write inside the read-only transaction.',
  ECONNREFUSED: 'Connection refused. Check MYSQL_HOST, MYSQL_PORT and database availability.',
  PROTOCOL_CONNECTION_LOST: 'Connection lost. A write may already have completed; verify before retrying.',
  ECONNRESET: 'Connection lost. A write may already have completed; verify before retrying.'
};

export function handleMySQLError(error: unknown): string {
  const code = errorCode(error);
  if (!code) return handleUnknownError(error);
  return `**MySQL error (${code})**\n\n${mysqlErrors[code] ?? 'The query failed. Check database permissions, schema and MySQL server logs.'}\n`;
}
export function handleTimeoutError(timeout: number): string {
  return (
    `**Error: Query execution timeout**\n\nThe request exceeded ${timeout}ms, including pool wait and cleanup. ` +
    'Use LIMIT, narrower filters or an optimized query. A write may already have completed; verify its outcome before retrying.\n'
  );
}
export function handleValidationError(error: ZodError): string {
  return (
    '**Input validation error**\n\n' +
    error.issues.map(issue => `- ${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('\n')
  );
}
export function handleUnknownError(error: unknown): string {
  return `**Error**\n\n${error instanceof Error ? error.message : 'Unexpected query failure'}\n`;
}
export function handleQueryError(error: unknown, timeout: number): string {
  if (error instanceof ZodError) return handleValidationError(error);
  if (isTimeoutError(error)) return handleTimeoutError(timeout);
  if (errorCode(error)) return handleMySQLError(error);
  return handleUnknownError(error);
}
