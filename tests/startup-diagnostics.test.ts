import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigurationError, startupCategory, logStartup } from '../src/utils/startup-diagnostics.js';
import { parseConfig } from '../src/services/config-loader.js';
afterEach(() => vi.restoreAllMocks());
describe('secret-safe startup evidence', () => {
  it.each([
    ['ER_ACCESS_DENIED_ERROR', 'database-authentication-denied'],
    ['ECONNREFUSED', 'database-connection-refused'],
    ['ENOTFOUND', 'database-host-lookup-failed'],
    ['ETIMEDOUT', 'database-connect-timeout'],
    ['CERT_HAS_EXPIRED', 'tls-certificate-invalid'],
    ['MYSQL_REQUEST_TIMEOUT', 'database-connect-timeout']
  ])('classifies %s only in the database connection phase', (code, category) => {
    const error = Object.assign(new Error('dummy-secret-host'), { code });
    expect(startupCategory('database-connect', error)).toBe(category);
    expect(startupCategory('mcp-transport', error)).toBe('mcp-server-startup-failed');
  });
  it('gives invalid existing configuration a stable category without its value', () => {
    let error: unknown;
    try {
      parseConfig({
        MYSQL_HOST: 'x',
        MYSQL_USER: 'x',
        MYSQL_PASSWORD: 'dummy-secret',
        MYSQL_PORT: 'invalid-secret-value'
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(startupCategory('configuration', error)).toBe('configuration-number-invalid');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    logStartup('configuration', 'failed', error);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });
  it('does not serialize unknown error data, messages or category strings', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    logStartup('configuration', 'failed', new ConfigurationError('dummy-secret', 'dummy-secret'));
    logStartup('database-connect', 'failed', { code: 'dummy-secret', sql: 'dummy-secret' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('dummy-secret');
  });
});
