// Isolated cloud-only protocol/TLS fixtures with dummy credentials. No database or SQL.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { createSecureContext, TLSSocket } from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import mysql from 'mysql2';
import type { Connection } from 'mysql2';
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { parseConfig } from '../src/services/config-loader.js';
import { cleartextAuthOptions } from '../src/services/cleartext-auth.js';
import { probeMySQLTls } from '../src/services/tls-probe.js';
import { startupErrorDetails, startupCategory } from '../src/utils/startup-diagnostics.js';
const password = String.raw` dummy !#$@:%"'\ Unicode עברית credential `;
const base = { MYSQL_HOST: 'localhost', MYSQL_USER: 'dummy', MYSQL_PASSWORD: password, MYSQL_SSL: 'true' };
let directory: string;
let key: Buffer;
let certificate: Buffer;
let wrongCertificate: Buffer;
const cleanups: (() => Promise<void>)[] = [];
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'mysql-auth-tls-'));
  const keyFile = join(directory, 'dummy.key');
  const certFile = join(directory, 'dummy.pem');
  const wrongFile = join(directory, 'wrong.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-keyout',
      keyFile,
      '-out',
      certFile
    ],
    { stdio: 'ignore' }
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-key',
      keyFile,
      '-days',
      '2',
      '-subj',
      '/CN=wrong.invalid',
      '-addext',
      'subjectAltName=DNS:wrong.invalid',
      '-out',
      wrongFile
    ],
    { stdio: 'ignore' }
  );
  key = readFileSync(keyFile);
  certificate = readFileSync(certFile);
  wrongCertificate = readFileSync(wrongFile);
}, 20000);
afterAll(() => rmSync(directory, { recursive: true, force: true }));
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function frame(payload: Buffer, sequence: number): Buffer {
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  header[3] = sequence;
  return Buffer.concat([header, payload]);
}
function hello(plugin: string, ssl: boolean, mfa: boolean): Buffer {
  const flags = 1 | 4 | 0x200 | 0x2000 | 0x8000 | 0x80000 | (ssl ? 0x800 : 0) | (mfa ? 0x10000000 : 0);
  const id = Buffer.alloc(4);
  id.writeUInt32LE(1);
  const low = Buffer.alloc(2);
  low.writeUInt16LE(flags & 0xffff);
  const high = Buffer.alloc(2);
  high.writeUInt16LE(flags >>> 16);
  return frame(
    Buffer.concat([
      Buffer.from([10]),
      Buffer.from('8.0.0-dummy\0'),
      id,
      Buffer.from('abcdefgh'),
      Buffer.from([0]),
      low,
      Buffer.from([45, 2, 0]),
      high,
      Buffer.from([21]),
      Buffer.alloc(10),
      Buffer.from('ijklmnopqrst\0'),
      Buffer.from(plugin + '\0')
    ]),
    0
  );
}
async function fixture(
  options: {
    ssl?: boolean;
    wrongIdentity?: boolean;
    advertiseClear?: boolean;
    mfa?: boolean;
    nonTlsAfterRequest?: boolean;
    stallGreeting?: boolean;
    invalidGreeting?: boolean;
  } = {}
) {
  const secure = options.ssl !== false;
  const cert = options.wrongIdentity ? wrongCertificate : certificate;
  const sockets = new Set<Socket>();
  const wire: Buffer[] = [];
  const authentication: Buffer[] = [];
  const sslRequests: Buffer[] = [];
  let clearResponses = 0;
  let resolvePeerClosed: () => void = () => {};
  const peerClosed = new Promise<void>(resolve => {
    resolvePeerClosed = resolve;
  });
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => {
      sockets.delete(socket);
      resolvePeerClosed();
    });
    socket.on('data', chunk => wire.push(Buffer.from(chunk)));
    if (!options.stallGreeting)
      socket.write(
        options.invalidGreeting
          ? frame(Buffer.from('invalid greeting'), 0)
          : hello(options.advertiseClear ? 'mysql_clear_password' : 'mysql_native_password', secure, !!options.mfa)
      );
    let initial = Buffer.alloc(0);
    const receive = (chunk: Buffer) => {
      initial = Buffer.concat([initial, chunk]);
      if (initial.length < 4 || initial.length < 4 + initial.readUIntLE(0, 3)) return;
      const length = initial.readUIntLE(0, 3);
      socket.removeListener('data', receive);
      const remaining = initial.subarray(4 + length);
      if (secure && length === 32) {
        sslRequests.push(initial.subarray(4, 36));
        if (options.nonTlsAfterRequest) {
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
          return;
        }
        socket.pause();
        // The SSLRequest and TLS ClientHello can share one TCP chunk. A public
        // Duplex bridge retains those bytes while upgrading the server side.
        const bridge = new Duplex({
          read() {
            socket.resume();
          },
          write(chunk, encoding, callback) {
            socket.write(chunk, encoding, callback);
          },
          final(callback) {
            socket.end(callback);
          },
          destroy(error, callback) {
            socket.destroy();
            callback(error);
          }
        });
        socket.on('data', chunk => {
          if (!bridge.push(chunk)) socket.pause();
        });
        socket.on('end', () => bridge.push(null));
        socket.on('close', () => bridge.destroy());
        if (remaining.length) bridge.push(remaining);
        const tls = new TLSSocket(bridge, { isServer: true, secureContext: createSecureContext({ key, cert }) });
        sockets.add(tls);
        tls.on('error', () => {});
        tls.on('close', () => sockets.delete(tls));
        packets(tls);
        socket.resume();
      } else {
        if (!secure) packets(socket, initial);
        else {
          authentication.push(initial.subarray(4, 4 + length));
          socket.destroy();
        }
      }
    };
    socket.on('data', receive);
    function packets(stream: Socket, first = Buffer.alloc(0)) {
      let pending = Buffer.alloc(0);
      const receivePacket = (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 4 && pending.length >= 4 + pending.readUIntLE(0, 3)) {
          const size = pending.readUIntLE(0, 3);
          const sequence = pending[3]!;
          const payload = pending.subarray(4, 4 + size);
          pending = pending.subarray(4 + size);
          authentication.push(payload);
          if (authentication.length === 1) {
            stream.write(
              frame(Buffer.concat([Buffer.from([0xfe]), Buffer.from('mysql_clear_password\0')]), sequence + 1)
            );
          } else {
            if (payload.equals(Buffer.from(password + '\0'))) clearResponses++;
            if (options.mfa && clearResponses === 1) {
              stream.write(
                frame(Buffer.concat([Buffer.from([0x02]), Buffer.from('mysql_clear_password\0')]), sequence + 1)
              );
            } else stream.write(frame(Buffer.from([0, 0, 0, 2, 0, 0, 0]), sequence + 1));
          }
        }
      };
      stream.on('data', receivePacket);
      if (first.length) receivePacket(first);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const port = address.port;
  const clients: Connection[] = [];
  cleanups.push(async () => {
    for (const client of clients) client.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  let connections = 0;
  server.on('connection', () => connections++);
  async function connect(enabled?: boolean, trust = true, useTls = true) {
    const config = parseConfig({
      ...base,
      MYSQL_PORT: String(port),
      MYSQL_SSL: String(useTls),
      ...(enabled !== undefined && { MYSQL_ENABLE_CLEARTEXT_PLUGIN: String(enabled) })
    });
    const options = cleartextAuthOptions(config);
    const client = mysql.createConnection({
      host: config.host,
      port,
      user: config.user,
      password: config.password,
      connectTimeout: 2500,
      ...options,
      ...(useTls && { ssl: { ...(options.ssl as object), ...(trust && { ca: cert }) } })
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) =>
      client.connect(error => {
        return error ? reject(error) : resolve();
      })
    );
    return { client, config };
  }
  return {
    connect,
    peerClosed,
    port,
    certificate: cert,
    sslRequests,
    authentication,
    wire,
    connections: () => connections,
    clearResponses: () => clearResponses
  };
}
describe('default cleartext authentication with the real driver and dummy endpoints', () => {
  it.each([false, true])(
    'accepts plaintext auth-switch/initial plugin requests by default (advertise=%s)',
    async advertiseClear => {
      const target = await fixture({ ssl: false, advertiseClear });
      const { config } = await target.connect(undefined, true, false);
      expect(config.enableCleartextPlugin).toBe(true);
      expect(config.ssl).toBeUndefined();
      expect(config.operationMode).toBe('READ_ONLY');
      expect(target.clearResponses()).toBe(1);
      expect(target.authentication[0]!.includes(Buffer.from(password))).toBe(false);
      expect(target.authentication[1]).toEqual(Buffer.from(password + '\0', 'utf8'));
      // The wire assertion intentionally documents the public plaintext risk.
      expect(Buffer.concat(target.wire).includes(Buffer.from(password))).toBe(true);
      expect(target.sslRequests).toHaveLength(0);
    }
  );
  it('honors an explicit opt-out over plaintext before sending the literal credential', async () => {
    const target = await fixture({ ssl: false, advertiseClear: true });
    await expect(target.connect(false, true, false)).rejects.toMatchObject({
      code: 'MYSQL_CLEAR_PASSWORD_NOT_ENABLED'
    });
    expect(target.clearResponses()).toBe(0);
    expect(Buffer.concat(target.wire).includes(Buffer.from(password))).toBe(false);
  });
  it.each([false, true])(
    'guards auth-switch and initially advertised cleartext (advertise=%s)',
    async advertiseClear => {
      const target = await fixture({ advertiseClear });
      const { client, config } = await target.connect();
      expect(target.clearResponses()).toBe(1);
      expect(target.authentication[0]!.includes(Buffer.from('mysql_native_password\0'))).toBe(true);
      expect(target.authentication[0]!.includes(Buffer.from(password))).toBe(false);
      expect(Buffer.concat(target.wire).includes(Buffer.from(password))).toBe(false);
      const hook = cleartextAuthOptions(config).authPlugins!.mysql_clear_password!;
      const response = hook({ connection: client, command: 'dummy' });
      expect(response(Buffer.alloc(0))).toEqual(Buffer.from(password + '\0'));
      client.config.ssl = { rejectUnauthorized: false, verifyIdentity: true };
      expect(() => response(Buffer.alloc(0))).toThrowError(
        expect.objectContaining({ code: 'MYSQL_CLEARTEXT_TLS_REQUIRED' })
      );
      client.config.ssl = undefined;
      expect(() => response(Buffer.alloc(0))).toThrowError(
        expect.objectContaining({ code: 'MYSQL_CLEARTEXT_TLS_REQUIRED' })
      );
    }
  );
  it('honors an explicit plugin opt-out over valid TLS', async () => {
    const target = await fixture({ advertiseClear: true });
    await expect(target.connect(false)).rejects.toMatchObject({ code: 'MYSQL_CLEAR_PASSWORD_NOT_ENABLED' });
    expect(target.clearResponses()).toBe(0);
  });
  it('never retries in plaintext when configured TLS is unsupported', async () => {
    const target = await fixture({ ssl: false, advertiseClear: true });
    await expect(target.connect()).rejects.toMatchObject({ code: 'HANDSHAKE_NO_SSL_SUPPORT' });
    expect(target.authentication).toHaveLength(0);
    expect(Buffer.concat(target.wire).includes(Buffer.from(password))).toBe(false);
    expect(target.connections()).toBe(1);
  });
  it('refuses an untrusted chain before sending authentication', async () => {
    const target = await fixture();
    let error: unknown;
    try {
      await target.connect(true, false);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'HANDSHAKE_SSL_ERROR' });
    expect(startupErrorDetails(error).tls).toEqual({
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      source: 'message-signature'
    });
    expect(startupCategory('database-connect', error)).toBe('tls-certificate-chain-unverified');
    expect(target.authentication).toHaveLength(0);
    expect(target.clearResponses()).toBe(0);
    expect(target.connections()).toBe(1);
  });
  it('refuses a trusted certificate for the wrong endpoint before authentication', async () => {
    const target = await fixture({ wrongIdentity: true });
    let error: unknown;
    try {
      await target.connect();
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'HANDSHAKE_SSL_ERROR' });
    expect(startupErrorDetails(error).tls).toEqual({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      source: 'message-signature'
    });
    expect(startupCategory('database-connect', error)).toBe('tls-endpoint-identity-mismatch');
    expect(target.authentication).toHaveLength(0);
    expect(target.clearResponses()).toBe(0);
    expect(target.connections()).toBe(1);
  });
  it.each([false, true])('does not reuse the first credential in a second factor (TLS=%s)', async useTls => {
    const target = await fixture({ mfa: true, ssl: useTls });
    let failure: unknown;
    try {
      await target.connect(undefined, true, useTls);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'MYSQL_CLEARTEXT_CREDENTIAL_CONTEXT_INVALID' });
    expect(startupCategory('database-connect', failure)).toBe('cleartext-auth-credential-context-invalid');
    expect(target.clearResponses()).toBe(1);
  });
  it.each(['host', 'port', 'user', 'password'] as const)(
    'refuses a changed plaintext %s context before another literal credential response',
    async field => {
      const target = await fixture({ ssl: false });
      const { client, config } = await target.connect(undefined, true, false);
      const response = cleartextAuthOptions(config).authPlugins!.mysql_clear_password!({
        connection: client,
        command: 'dummy'
      });
      Object.assign(client.config, { [field]: field === 'port' ? config.port + 1 : 'different-dummy-context' });
      expect(() => response(Buffer.alloc(0))).toThrowError(
        expect.objectContaining({ code: 'MYSQL_CLEARTEXT_CREDENTIAL_CONTEXT_INVALID' })
      );
      expect(target.clearResponses()).toBe(1);
    }
  );
  it('rejects substituted or closed plaintext transports instead of treating them as an authenticated endpoint', async () => {
    const target = await fixture({ ssl: false });
    const { client, config } = await target.connect(undefined, true, false);
    const response = cleartextAuthOptions(config).authPlugins!.mysql_clear_password!({
      connection: client,
      command: 'dummy'
    });
    const stream = Reflect.get(client, 'stream') as Socket;
    Reflect.set(client, 'stream', { readyState: 'open', remotePort: config.port });
    expect(() => response(Buffer.alloc(0))).toThrowError(
      expect.objectContaining({ code: 'MYSQL_CLEARTEXT_TRANSPORT_MISMATCH' })
    );
    Reflect.set(client, 'stream', stream);
    client.config.ssl = { rejectUnauthorized: true, verifyIdentity: true };
    expect(() => response(Buffer.alloc(0))).toThrowError(
      expect.objectContaining({ code: 'MYSQL_CLEARTEXT_TRANSPORT_MISMATCH' })
    );
    client.config.ssl = undefined;
    stream.destroy();
    expect(() => response(Buffer.alloc(0))).toThrowError(
      expect.objectContaining({ code: 'MYSQL_CLEARTEXT_TRANSPORT_MISMATCH' })
    );
  });
  it('rechecks actual authorization and peer identity on every plugin callback', async () => {
    const target = await fixture();
    const { client, config } = await target.connect();
    const socket: unknown = Reflect.get(client, 'stream');
    expect(socket).toBeInstanceOf(TLSSocket);
    const tls = socket as TLSSocket;
    const response = cleartextAuthOptions(config).authPlugins!.mysql_clear_password!({
      connection: client,
      command: 'dummy'
    });
    vi.spyOn(tls, 'getPeerCertificate').mockReturnValue({} as PeerCertificate);
    expect(() => response(Buffer.alloc(0))).toThrowError(
      expect.objectContaining({ code: 'MYSQL_CLEARTEXT_IDENTITY_MISMATCH' })
    );
    vi.restoreAllMocks();
    vi.spyOn(tls, 'getProtocol').mockReturnValue('TLSv1.1');
    expect(() => response(Buffer.alloc(0))).toThrowError(
      expect.objectContaining({ code: 'MYSQL_CLEARTEXT_TLS_UNVERIFIED' })
    );
    vi.restoreAllMocks();
    tls.authorized = false;
    expect(() => response(Buffer.alloc(0))).toThrowError(
      expect.objectContaining({ code: 'MYSQL_CLEARTEXT_TLS_UNVERIFIED' })
    );
    tls.authorized = true;
    tls.destroy();
    expect(() => response(Buffer.alloc(0))).toThrowError(
      expect.objectContaining({ code: 'MYSQL_CLEARTEXT_TLS_UNVERIFIED' })
    );
  });
  it('rejects a duck-typed non-TLS stream and unsafe programmatic configuration', () => {
    const config = parseConfig({ ...base, MYSQL_ENABLE_CLEARTEXT_PLUGIN: 'true' });
    const hook = cleartextAuthOptions(config).authPlugins!.mysql_clear_password!;
    const connection = {
      config: { ...config, ssl: { rejectUnauthorized: true, verifyIdentity: true } },
      stream: { encrypted: true, authorized: true }
    } as unknown as Connection;
    expect(() => hook({ connection, command: 'dummy' })(Buffer.alloc(0))).toThrowError(
      expect.objectContaining({ code: 'MYSQL_CLEARTEXT_TLS_UNVERIFIED' })
    );
    expect(cleartextAuthOptions({ ...config, ssl: undefined }).ssl).toBeUndefined();
    expect(() => cleartextAuthOptions({ ...config, host: '127.0.0.1' })).toThrow('DNS MYSQL_HOST');
    expect(cleartextAuthOptions({ ...config, enableCleartextPlugin: false })).toMatchObject({
      enableCleartextPlugin: false
    });
    expect(cleartextAuthOptions({ ...config, enableCleartextPlugin: false }).authPlugins).toBeUndefined();
  });
});

// These tests use no MySQL client at all: the probe must never enter login.
describe('credential-free strict MySQL STARTTLS probe', () => {
  it('sends only a 32-byte SSLRequest and TLS, even when extraneous credentials are supplied', async () => {
    const target = await fixture({ advertiseClear: true });
    const input = {
      host: 'localhost',
      port: target.port,
      ca: target.certificate,
      user: 'must-never-be-sent-user',
      password
    };
    const result = await probeMySQLTls(input);
    await target.peerClosed;
    expect(result).toMatchObject({
      ok: true,
      stage: 'tls-handshake',
      authenticationSent: false,
      mysqlTlsAdvertised: true
    });
    expect(['TLSv1.2', 'TLSv1.3']).toContain(result.tlsProtocol);
    expect(target.sslRequests).toHaveLength(1);
    expect(target.sslRequests[0]).toHaveLength(32);
    expect(target.sslRequests[0]!.subarray(9)).toEqual(Buffer.alloc(23));
    expect(target.authentication).toHaveLength(0);
    expect(Buffer.concat(target.wire).includes(Buffer.from(password))).toBe(false);
    expect(Buffer.concat(target.wire).includes(Buffer.from(input.user))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('localhost');
  });
  it('reports the original untrusted-chain code without a driver wrapper or authentication', async () => {
    const target = await fixture();
    const result = await probeMySQLTls({ host: 'localhost', port: target.port });
    expect(result).toMatchObject({
      ok: false,
      authenticationSent: false,
      category: 'tls-certificate-chain-unverified',
      error: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT', tls: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT', source: 'error-code' } }
    });
    expect(target.authentication).toHaveLength(0);
  });
  it('reports the original endpoint-identity code before any login', async () => {
    const target = await fixture({ wrongIdentity: true });
    const result = await probeMySQLTls({ host: 'localhost', port: target.port, ca: target.certificate });
    expect(result).toMatchObject({
      ok: false,
      authenticationSent: false,
      category: 'tls-endpoint-identity-mismatch',
      error: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }
    });
    expect(target.authentication).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('wrong.invalid');
    expect(JSON.stringify(result)).not.toContain('localhost');
  });
  it('distinguishes an endpoint without MySQL SSL capability and sends nothing', async () => {
    const target = await fixture({ ssl: false });
    const result = await probeMySQLTls({ host: 'localhost', port: target.port, ca: target.certificate });
    expect(result).toMatchObject({
      ok: false,
      authenticationSent: false,
      mysqlTlsAdvertised: false,
      category: 'tls-not-supported-by-server'
    });
    expect(target.wire).toHaveLength(0);
    expect(target.authentication).toHaveLength(0);
  });
  it('classifies an unexpected non-TLS response without treating it as proof of a particular server setup', async () => {
    const target = await fixture({ nonTlsAfterRequest: true });
    const result = await probeMySQLTls({ host: 'localhost', port: target.port, ca: target.certificate });
    expect(result).toMatchObject({
      ok: false,
      authenticationSent: false,
      category: 'tls-protocol-mismatch'
    });
    // Node's bundled OpenSSL versions report different codes for these same
    // non-TLS bytes. Preserve the original evidence instead of normalizing it.
    expect(['ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_PACKET_LENGTH_TOO_LONG']).toContain(result.error?.code);
    expect(result.error?.tls?.source).toBe('error-code');
    expect(target.authentication).toHaveLength(0);
  });
  it('bounds greeting waits and rejects malformed greetings without authentication', async () => {
    const stalled = await fixture({ stallGreeting: true });
    expect(await probeMySQLTls({ host: 'localhost', port: stalled.port, timeoutMs: 50 })).toMatchObject({
      ok: false,
      stage: 'mysql-greeting',
      category: 'tls-probe-timeout',
      authenticationSent: false
    });
    const malformed = await fixture({ invalidGreeting: true });
    expect(await probeMySQLTls({ host: 'localhost', port: malformed.port })).toMatchObject({
      ok: false,
      stage: 'mysql-greeting',
      category: 'tls-probe-invalid-mysql-greeting',
      authenticationSent: false
    });
    expect(stalled.wire).toHaveLength(0);
    expect(malformed.wire).toHaveLength(0);
  });
  it('rejects invalid inputs before opening a connection', async () => {
    expect(await probeMySQLTls({ host: '127.0.0.1', port: 3306 })).toMatchObject({
      ok: false,
      stage: 'input',
      authenticationSent: false
    });
    expect(await probeMySQLTls({ host: 'localhost', port: 0 })).toMatchObject({
      ok: false,
      stage: 'input',
      authenticationSent: false
    });
  });
});
