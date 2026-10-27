import { createConnection, isIP, type Socket } from 'node:net';
import { connect as connectTls, checkServerIdentity, type TLSSocket } from 'node:tls';
import { startupCategory, startupErrorDetails, type StartupErrorDetails } from '../utils/startup-diagnostics.js';

export interface MySQLTlsProbeOptions {
  host: string;
  port: number;
  ca?: string | Buffer;
  timeoutMs?: number;
}
type ProbeStage = 'input' | 'tcp-connect' | 'mysql-greeting' | 'tls-handshake';
export interface MySQLTlsProbeResult {
  ok: boolean;
  stage: ProbeStage;
  authenticationSent: false;
  mysqlTlsAdvertised: boolean | null;
  tlsProtocol?: string;
  category?: string;
  error?: StartupErrorDetails;
}
function failure(code: string): Error {
  return Object.assign(new Error('MySQL TLS-only probe stopped'), { code });
}
/** One connection, SSLRequest + verified TLS only. Never sends a MySQL login or SQL. */
export async function probeMySQLTls(options: MySQLTlsProbeOptions): Promise<MySQLTlsProbeResult> {
  const { host, port, ca } = options;
  const timeout = options.timeoutMs ?? 5000;
  if (
    !host ||
    isIP(host) ||
    /[\s\0/\\:@?#]/.test(host) ||
    host.includes('[') ||
    host.includes(']') ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isInteger(timeout) ||
    timeout < 50 ||
    timeout > 10000
  )
    return {
      ok: false,
      stage: 'input',
      authenticationSent: false,
      mysqlTlsAdvertised: null,
      category: 'tls-probe-invalid-input'
    };
  return new Promise(resolve => {
    let stage: ProbeStage = 'tcp-connect';
    let advertised: boolean | null = null;
    let socket: Socket | undefined;
    let secure: TLSSocket | undefined;
    let done = false;
    let greeting = Buffer.alloc(0);
    const timer = setTimeout(() => finish(failure('MYSQL_TLS_PROBE_TIMEOUT')), timeout);
    const finish = (error?: unknown): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const protocol = secure?.getProtocol();
      secure?.destroy();
      socket?.destroy();
      resolve({
        ok: error === undefined,
        stage,
        authenticationSent: false,
        mysqlTlsAdvertised: advertised,
        ...(error === undefined && protocol && { tlsProtocol: protocol }),
        ...(error !== undefined && {
          category: startupCategory('database-connect', error),
          error: startupErrorDetails(error)
        })
      });
    };
    const readGreeting = (chunk: Buffer): void => {
      if (done) return;
      if (greeting.length + chunk.length > 65539) {
        finish(failure('MYSQL_TLS_GREETING_INVALID'));
        return;
      }
      greeting = Buffer.concat([greeting, chunk]);
      if (greeting.length < 4) return;
      const size = greeting.readUIntLE(0, 3);
      if (size > 65535 || greeting[3] !== 0) {
        finish(failure('MYSQL_TLS_GREETING_INVALID'));
        return;
      }
      if (greeting.length < 4 + size) return;
      const payload = greeting.subarray(4);
      const versionEnd = payload.indexOf(0, 1);
      const flagsOffset = versionEnd + 1 + 4 + 8 + 1;
      if (payload.length !== size || payload[0] !== 10 || versionEnd < 2 || payload.length < flagsOffset + 18) {
        finish(failure('MYSQL_TLS_GREETING_INVALID'));
        return;
      }
      const low = payload.readUInt16LE(flagsOffset);
      advertised = (low & 0x800) !== 0;
      if (!advertised) {
        finish(failure('HANDSHAKE_NO_SSL_SUPPORT'));
        return;
      }
      if (!(low & 0x200)) {
        finish(failure('MYSQL_TLS_GREETING_INVALID'));
        return;
      }
      const high = payload.readUInt16LE(flagsOffset + 5);
      const capabilities = (high * 65536 + low) >>> 0;
      // Protocol::SSLRequest is exactly 32 bytes, ending before username.
      const request = Buffer.alloc(36);
      request.writeUIntLE(32, 0, 3);
      request[3] = 1;
      request.writeUInt32LE(((capabilities & (1 | 4 | 0x2000 | 0x8000 | 0x80000)) | 0xa00) >>> 0, 4);
      request.writeUInt32LE(0x1000000, 8);
      request[12] = payload[flagsOffset + 2] ?? 45;
      socket!.removeListener('data', readGreeting);
      stage = 'tls-handshake';
      socket!.write(request);
      try {
        secure = connectTls(
          {
            socket: socket!,
            host,
            servername: host,
            ca,
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2',
            checkServerIdentity: (_name, cert) => checkServerIdentity(host, cert)
          },
          () => {
            try {
              if (!secure!.authorized) {
                finish(failure('MYSQL_CLEARTEXT_TLS_UNVERIFIED'));
                return;
              }
              const identity = checkServerIdentity(host, secure!.getPeerCertificate(true));
              if (identity) {
                finish(identity);
                return;
              }
              finish(); // Destroy immediately; no HandshakeResponse/login is built.
            } catch (error) {
              finish(error);
            }
          }
        );
        secure.once('error', finish);
        secure.once('close', () => {
          if (!done) finish(failure('MYSQL_TLS_PROBE_CLOSED'));
        });
      } catch (error) {
        finish(error);
      }
    };
    try {
      socket = createConnection({ host, port });
      socket.once('connect', () => {
        stage = 'mysql-greeting';
      });
      socket.on('data', readGreeting);
      socket.once('error', finish);
      socket.once('close', () => {
        if (!done) finish(failure('MYSQL_TLS_PROBE_CLOSED'));
      });
    } catch (error) {
      finish(error);
    }
  });
}
