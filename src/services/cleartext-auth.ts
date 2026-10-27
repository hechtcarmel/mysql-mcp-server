import { isIP } from 'node:net';
import { TLSSocket, checkServerIdentity } from 'node:tls';
import type { AuthPlugin, PoolOptions } from 'mysql2';
import type { ServerConfig } from '../types.js';
import { ConfigurationError } from '../utils/startup-diagnostics.js';

/** Verify the transport policy before creating a pool or allowing any authentication. */
export function validateCleartextConfig(config: ServerConfig): void {
  if (config.enableCleartextPlugin !== true) return;
  if (!config.ssl || config.ssl.rejectUnauthorized !== true) {
    throw new ConfigurationError(
      'cleartext-auth-requires-verified-tls',
      'MYSQL_ENABLE_CLEARTEXT_PLUGIN requires TLS with MYSQL_SSL_REJECT_UNAUTHORIZED=true'
    );
  }
  // mysql2 skips its pre-authentication identity check for IP literals. A DNS
  // hostname makes verifyIdentity protect initial authentication methods too.
  if (
    !config.host ||
    isIP(config.host) ||
    /[\s\0/\\:@?#]/.test(config.host) ||
    config.host.includes('[') ||
    config.host.includes(']')
  ) {
    throw new ConfigurationError(
      'cleartext-auth-requires-dns-host',
      'MYSQL_ENABLE_CLEARTEXT_PLUGIN requires a certificate-matching DNS MYSQL_HOST'
    );
  }
}
function refused(code: string): never {
  // mysql2 may overwrite the outer code with AUTH_SWITCH_PLUGIN_ERROR.
  const cause = Object.assign(new Error('Verified TLS authentication policy'), { code });
  throw Object.assign(new Error('Cleartext authentication refused by verified TLS policy', { cause }), { code });
}

/** Only the public authPlugins hook is used; never turn on the unguarded built-in shortcut. */
export function cleartextAuthOptions(
  config: ServerConfig
): Pick<PoolOptions, 'ssl' | 'authPlugins' | 'enableCleartextPlugin'> {
  if (config.enableCleartextPlugin !== true) return { ssl: config.ssl, enableCleartextPlugin: false };
  validateCleartextConfig(config);
  const { host, user, password } = config;
  const plugin: AuthPlugin =
    ({ connection }) =>
    () => {
      const ssl = connection.config.ssl;
      if (!ssl || typeof ssl !== 'object' || ssl.rejectUnauthorized !== true || ssl.verifyIdentity !== true)
        refused('MYSQL_CLEARTEXT_TLS_REQUIRED');
      // mysql2 exposes its upgraded transport at this runtime seam. Do not trust
      // config.ssl alone, a duck-typed socket, or an earlier callback's TLS state.
      const stream: unknown = Reflect.get(connection, 'stream');
      if (
        !(stream instanceof TLSSocket) ||
        !stream.encrypted ||
        !stream.authorized ||
        stream.authorizationError ||
        stream.destroyed ||
        !['TLSv1.2', 'TLSv1.3'].includes(stream.getProtocol() ?? '')
      )
        refused('MYSQL_CLEARTEXT_TLS_UNVERIFIED');
      try {
        if (checkServerIdentity(host, stream.getPeerCertificate(true))) refused('MYSQL_CLEARTEXT_IDENTITY_MISMATCH');
      } catch {
        refused('MYSQL_CLEARTEXT_IDENTITY_MISMATCH');
      }
      // Do not reuse the first-factor credential after a driver changeUser/MFA
      // transition, or follow server-controlled password/plugin substitutions.
      if (connection.config.user !== user || connection.config.password !== password)
        refused('MYSQL_CLEARTEXT_CREDENTIAL_CONTEXT_INVALID');
      return Buffer.from(`${password}\0`, 'utf8');
    };
  return {
    ssl: { ...config.ssl, verifyIdentity: true, minVersion: 'TLSv1.2' },
    enableCleartextPlugin: false,
    authPlugins: { mysql_clear_password: plugin }
  };
}
