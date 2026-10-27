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
  'tls-file-unavailable'
]);
const connectionCategories: Record<string, string> = {
  ER_ACCESS_DENIED_ERROR: 'database-authentication-denied',
  ER_DBACCESS_DENIED_ERROR: 'database-access-denied',
  ER_BAD_DB_ERROR: 'database-default-schema-unavailable',
  ECONNREFUSED: 'database-connection-refused',
  ENOTFOUND: 'database-host-lookup-failed',
  EAI_AGAIN: 'database-host-lookup-failed',
  ENETUNREACH: 'database-network-unreachable',
  EHOSTUNREACH: 'database-network-unreachable',
  ETIMEDOUT: 'database-connect-timeout',
  MYSQL_REQUEST_TIMEOUT: 'database-connect-timeout',
  ECONNRESET: 'database-connection-reset',
  PROTOCOL_CONNECTION_LOST: 'database-connection-lost',
  CERT_HAS_EXPIRED: 'tls-certificate-invalid',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls-certificate-invalid',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'tls-certificate-invalid',
  SELF_SIGNED_CERT_IN_CHAIN: 'tls-certificate-invalid',
  ERR_TLS_CERT_ALTNAME_INVALID: 'tls-certificate-invalid',
  ERR_OSSL_PEM_NO_START_LINE: 'tls-material-invalid'
};
export function startupCategory(stage: StartupStage, error: unknown): string {
  if (stage === 'configuration')
    return error instanceof ConfigurationError && configurationCategories.has(error.category)
      ? error.category
      : 'configuration-parse-failed';
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
  if (stage === 'database-connect' && Object.hasOwn(connectionCategories, code)) return connectionCategories[code]!;
  if (stage === 'database-pool' && code.startsWith('ERR_OSSL_')) return 'tls-material-invalid';
  return stage === 'mcp-transport' ? 'mcp-server-startup-failed' : 'server-startup-failed';
}
export function logStartup(stage: StartupStage, status: 'started' | 'ready' | 'failed', error?: unknown): void {
  console.error(
    JSON.stringify({
      level: status === 'failed' ? 'error' : 'info',
      event: 'mysql-startup',
      stage,
      status,
      ...(status === 'failed' && { category: startupCategory(stage, error) })
    })
  );
}
