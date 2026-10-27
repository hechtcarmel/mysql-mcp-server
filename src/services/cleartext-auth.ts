import { isIP, Socket } from 'node:net';
import { TLSSocket, checkServerIdentity } from 'node:tls';
import type { AuthPlugin, PoolOptions } from 'mysql2';
import type { ServerConfig } from '../types.js';
import { ConfigurationError } from '../utils/startup-diagnostics.js';

/** Verify the transport policy before creating a pool or allowing any authentication. */
export function validateCleartextConfig(config: ServerConfig): void {
  // Plain TCP is an intentional supported mode. A configured TLS connection
  // must always retain verification, even when the cleartext plugin is off.
  if (!config.ssl) return;
  if (config.ssl.rejectUnauthorized !== true) {
    throw new ConfigurationError('tls-verification-required', 'MySQL TLS requires MYSQL_SSL_REJECT_UNAUTHORIZED=true');
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
    throw new ConfigurationError('tls-dns-host-required', 'MySQL TLS requires a certificate-matching DNS MYSQL_HOST');
  }
}
function refused(code: string): never {
  // mysql2 may overwrite the outer code with AUTH_SWITCH_PLUGIN_ERROR.
  const cause = Object.assign(new Error('MySQL authentication policy'), { code });
  throw Object.assign(new Error('Cleartext authentication refused by connection policy', { cause }), { code });
}

/** Only the public authPlugins hook is used; never turn on the unguarded built-in shortcut. */
export function cleartextAuthOptions(
  config: ServerConfig
): Pick<PoolOptions, 'ssl' | 'authPlugins' | 'enableCleartextPlugin'> {
  validateCleartextConfig(config);
  const ssl = config.ssl ? { ...config.ssl, verifyIdentity: true, minVersion: 'TLSv1.2' as const } : undefined;
  if (config.enableCleartextPlugin !== true) return { ssl, enableCleartextPlugin: false };
  const { host, port, user, password } = config;
  const useTls = ssl !== undefined;
  const plugin: AuthPlugin =
    ({ connection }) =>
    () => {
      // Bind every response to the configured endpoint and credential context.
      // Never reuse the first factor after changeUser/MFA substitutions.
      if (
        connection.config.host !== host ||
        connection.config.port !== port ||
        connection.config.user !== user ||
        connection.config.password !== password
      )
        refused('MYSQL_CLEARTEXT_CREDENTIAL_CONTEXT_INVALID');
      // mysql2 exposes its upgraded transport at this runtime seam. Do not trust
      // config.ssl alone, a duck-typed socket, or an earlier callback's TLS state.
      const stream: unknown = Reflect.get(connection, 'stream');
      if (useTls) {
        const currentSsl = connection.config.ssl;
        if (
          !currentSsl ||
          typeof currentSsl !== 'object' ||
          currentSsl.rejectUnauthorized !== true ||
          currentSsl.verifyIdentity !== true
        )
          refused('MYSQL_CLEARTEXT_TLS_REQUIRED');
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
      } else if (
        connection.config.ssl ||
        !(stream instanceof Socket) ||
        stream instanceof TLSSocket ||
        stream.destroyed ||
        stream.connecting ||
        stream.readyState !== 'open' ||
        stream.remotePort !== port
      ) {
        // This branch exists only when TLS was absent in the original config.
        // A failed or altered TLS connection can never enter plaintext mode.
        refused('MYSQL_CLEARTEXT_TRANSPORT_MISMATCH');
      }
      return Buffer.from(`${password}\0`, 'utf8');
    };
  return {
    ssl,
    enableCleartextPlugin: false,
    authPlugins: { mysql_clear_password: plugin }
  };
}
