import categories from './startup-error-codes.json' with { type: 'json' };

export interface TlsDiagnostic {
  code: string;
  source: 'error-code' | 'openssl-reason' | 'message-signature';
}
function field(error: unknown, key: string): unknown {
  try {
    return error && typeof error === 'object' ? Reflect.get(error, key) : undefined;
  } catch {
    return undefined;
  }
}
const messages: Record<string, string> = {
  'self-signed certificate': 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'self signed certificate': 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'self-signed certificate in certificate chain': 'SELF_SIGNED_CERT_IN_CHAIN',
  'self signed certificate in certificate chain': 'SELF_SIGNED_CERT_IN_CHAIN',
  'unable to verify the first certificate': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'unable to get local issuer certificate': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'unable to get issuer certificate': 'UNABLE_TO_GET_ISSUER_CERT',
  'certificate has expired': 'CERT_HAS_EXPIRED',
  'certificate is not yet valid': 'CERT_NOT_YET_VALID',
  'certificate revoked': 'CERT_REVOKED'
};
const reasons: Record<string, string> = {
  'wrong version number': 'ERR_SSL_WRONG_VERSION_NUMBER',
  'unknown protocol': 'ERR_SSL_UNKNOWN_PROTOCOL',
  'unsupported protocol': 'ERR_SSL_UNSUPPORTED_PROTOCOL',
  'tlsv1 alert protocol version': 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION',
  'no shared cipher': 'ERR_SSL_NO_SHARED_CIPHER',
  'sslv3 alert handshake failure': 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE',
  'tlsv13 alert certificate required': 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED',
  'ca md too weak': 'ERR_SSL_CA_MD_TOO_WEAK',
  'ee key too small': 'ERR_SSL_EE_KEY_TOO_SMALL',
  'tlsv1 alert unknown ca': 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
  'sslv3 alert bad certificate': 'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE',
  'tlsv1 alert certificate expired': 'ERR_SSL_TLSV1_ALERT_CERTIFICATE_EXPIRED'
};
/** Never serializes arbitrary messages/reasons. Inferred codes retain their provenance. */
export function tlsDiagnostic(error: unknown): TlsDiagnostic | undefined {
  const code = field(error, 'code');
  if (typeof code !== 'string' || !Object.hasOwn(categories, code)) return undefined;
  const category = categories[code as keyof typeof categories];
  if (code !== 'HANDSHAKE_SSL_ERROR') return category.startsWith('tls-') ? { code, source: 'error-code' } : undefined;
  // mysql2 overwrites the Node TLS error code. Recover only fixed signatures,
  // and label inference explicitly instead of pretending the original survived.
  const reason = field(error, 'reason');
  if (typeof reason === 'string' && reason.length <= 128 && Object.hasOwn(reasons, reason.toLowerCase()))
    return { code: reasons[reason.toLowerCase()]!, source: 'openssl-reason' };
  const message = field(error, 'message');
  if (typeof message !== 'string' || message.length > 8192) return undefined;
  const help = '; if the root CA is installed locally, try running Node.js with --use-system-ca';
  const normalized = (message.endsWith(help) ? message.slice(0, -help.length) : message).toLowerCase();
  if (Object.hasOwn(messages, normalized)) return { code: messages[normalized]!, source: 'message-signature' };
  if (message.startsWith("Hostname/IP does not match certificate's altnames:"))
    return { code: 'ERR_TLS_CERT_ALTNAME_INVALID', source: 'message-signature' };
  return undefined;
}
