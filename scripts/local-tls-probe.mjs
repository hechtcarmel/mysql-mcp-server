// Separate, explicitly scoped TLS-only diagnostic. No env-file loading or credentials.
import { readFileSync } from 'node:fs';
import { probeMySQLTls } from '../dist/services/tls-probe.js';

let result;
try {
  const host = process.env.MYSQL_HOST;
  const port = process.env.MYSQL_PORT || '3306';
  const timeout = process.env.MYSQL_TLS_PROBE_TIMEOUT_MS || '5000';
  if (!host || !/^\d+$/.test(port) || !/^\d+$/.test(timeout)) throw new Error('invalid-input');
  let ca;
  if (process.env.MYSQL_SSL_CA) {
    try {
      ca = readFileSync(process.env.MYSQL_SSL_CA);
    } catch {
      throw new Error('ca-file-unavailable');
    }
  }
  // Whitelist only these options. Never pass MYSQL_USER/PASSWORD, client keys,
  // authentication flags, or arbitrary environment values into a connection.
  result = await probeMySQLTls({ host, port: Number(port), ca, timeoutMs: Number(timeout) });
} catch (error) {
  result = {
    ok: false,
    stage: 'input',
    authenticationSent: false,
    mysqlTlsAdvertised: null,
    category:
      error instanceof Error && error.message === 'ca-file-unavailable'
        ? 'tls-file-unavailable'
        : 'tls-probe-invalid-input'
  };
}
process.stdout.write(JSON.stringify({ component: 'mysql-tls-only-probe', ...result }) + '\n');
process.exitCode = result.ok ? 0 : 1;
