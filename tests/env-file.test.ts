import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/services/config-loader.js';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mysql-env-'));
  directories.push(directory);
  const file = join(directory, '.env');
  writeFileSync(
    file,
    [
      'MYSQL_HOST=old-host',
      'MYSQL_PORT=3307',
      'MYSQL_USER=existing-user',
      'MYSQL_PASSWORD="existing # password"',
      'MYSQL_DATABASE=ExistingDatabase',
      'MYSQL_ALLOW_WRITE=false',
      'MYSQL_POOL_SIZE=5',
      'MYSQL_CONNECTION_TIMEOUT=12000',
      'MYSQL_QUERY_TIMEOUT=45000',
      `MYSQL_SSL_CA=${join(directory, 'ca.pem')}`,
      `MYSQL_SSL_CERT=${join(directory, 'cert.pem')}`,
      `MYSQL_SSL_KEY=${join(directory, 'key.pem')}`,
      'MYSQL_SSL_REJECT_UNAUTHORIZED=true'
    ].join('\n')
  );
  for (const name of ['ca', 'cert', 'key']) writeFileSync(join(directory, `${name}.pem`), `test-${name}`);
  return { directory, file };
}
describe('existing environment files', () => {
  it('loads all existing connection, mode, pool, timeout and TLS variables quietly', () => {
    const { directory, file } = fixture();
    const stdout = vi.spyOn(process.stdout, 'write');
    const result = loadConfig({ MYSQL_ENV_FILE: file }, directory);
    expect(stdout).not.toHaveBeenCalled();
    expect(result).toEqual({
      enableCleartextPlugin: false,
      host: 'old-host',
      port: 3307,
      user: 'existing-user',
      password: 'existing # password',
      database: 'ExistingDatabase',
      operationMode: 'READ_ONLY',
      poolSize: 5,
      connectionTimeout: 12000,
      queryTimeout: 45000,
      maxRows: 1000,
      ssl: { ca: 'test-ca', cert: 'test-cert', key: 'test-key', rejectUnauthorized: true }
    });
  });
  it('retains process-environment precedence over file values', () => {
    const { directory, file } = fixture();
    const result = loadConfig(
      { MYSQL_ENV_FILE: file, MYSQL_HOST: 'override-host', MYSQL_ALLOW_WRITE: 'true' },
      directory
    );
    expect(result).toMatchObject({ host: 'override-host', operationMode: 'WRITE_ENABLED' });
  });
  it('loads a default .env from the working directory', () => {
    const { directory } = fixture();
    expect(loadConfig({}, directory)).toMatchObject({ host: 'old-host', operationMode: 'READ_ONLY' });
  });
  it('fails for a missing explicitly selected file', () => {
    const { directory } = fixture();
    expect(() => loadConfig({ MYSQL_ENV_FILE: join(directory, 'missing.env') }, directory)).toThrow(
      'Failed to load MYSQL_ENV_FILE'
    );
  });
});
