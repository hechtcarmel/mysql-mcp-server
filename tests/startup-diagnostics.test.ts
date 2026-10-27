import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ConfigurationError,
  startupCategory,
  startupErrorDetails,
  logStartup
} from '../src/utils/startup-diagnostics.js';
import { parseConfig } from '../src/services/config-loader.js';
afterEach(() => vi.restoreAllMocks());
describe('secret-safe startup evidence', () => {
  it.each([
    ['ER_ACCESS_DENIED_ERROR', 'database-authentication-denied'],
    ['ECONNREFUSED', 'database-connection-refused'],
    ['ENOTFOUND', 'database-host-lookup-failed'],
    ['ETIMEDOUT', 'database-connect-timeout'],
    ['CERT_HAS_EXPIRED', 'tls-certificate-invalid'],
    ['MYSQL_REQUEST_TIMEOUT', 'database-connect-timeout'],
    ['HANDSHAKE_SSL_ERROR', 'tls-handshake-failed'],
    ['HANDSHAKE_NO_SSL_SUPPORT', 'tls-not-supported-by-server'],
    ['AUTH_SWITCH_PLUGIN_ERROR', 'database-authentication-plugin-failed'],
    ['MYSQL_CLEAR_PASSWORD_NOT_ENABLED', 'database-cleartext-authentication-disabled'],
    ['ER_NOT_SUPPORTED_AUTH_MODE', 'database-authentication-mode-unsupported'],
    ['ER_SECURE_TRANSPORT_REQUIRED', 'database-secure-transport-required'],
    ['ERR_INVALID_ARG_TYPE', 'driver-configuration-invalid'],
    ['ER_CON_COUNT_ERROR', 'database-connection-limit']
  ])('classifies %s only in the database connection phase', (code, category) => {
    const error = Object.assign(new Error('dummy-secret-host'), { code });
    expect(startupCategory('database-connect', error)).toBe(category);
    expect(startupErrorDetails(error)).toMatchObject({ errorClass: 'Error', code, codeStatus: 'recognized' });
    expect(startupCategory('mcp-transport', error)).toBe('mcp-server-startup-failed');
  });
  it('finds allowlisted codes in nested cause and aggregate errors without copying their messages', () => {
    const nested = Object.assign(new Error('dummy-secret'), { code: 'ECONNREFUSED', address: 'dummy-secret' });
    const error = new Error('dummy-secret', { cause: new AggregateError([nested], 'dummy-secret') });
    expect(startupCategory('database-connect', error)).toBe('database-connection-refused');
    expect(startupErrorDetails(error)).toEqual({
      errorClass: 'Error',
      code: null,
      codeStatus: 'missing',
      truncated: false,
      causes: [
        { errorClass: 'AggregateError', code: null, codeStatus: 'missing' },
        { errorClass: 'Error', code: 'ECONNREFUSED', codeStatus: 'recognized' }
      ]
    });
    expect(JSON.stringify(startupErrorDetails(error))).not.toContain('dummy-secret');
  });
  it('bounds deep, cyclic and large aggregate diagnostics', () => {
    const errors = Array.from({ length: 20 }, () => new Error('dummy-secret'));
    const aggregate = new AggregateError(errors, 'dummy-secret');
    aggregate.cause = aggregate;
    const details = startupErrorDetails(aggregate);
    expect(details.causes.length).toBeLessThanOrEqual(7);
    expect(details.truncated).toBe(true);
    const loop = new Error('dummy-secret');
    loop.cause = loop;
    expect(startupErrorDetails(loop).causes).toEqual([]);
    const deep = new Error('dummy-secret', {
      cause: new Error('dummy-secret', { cause: new Error('dummy-secret', { cause: errors[0] }) })
    });
    expect(startupErrorDetails(deep).truncated).toBe(true);
  });
  it('distinguishes missing and unrecognized codes without disclosing arbitrary values or names', () => {
    const error = Object.assign(new TypeError('dummy-secret'), {
      name: 'dummy-secret',
      code: 'dummy-secret',
      sqlState: 'dummy-secret'
    });
    expect(startupErrorDetails(error)).toMatchObject({
      errorClass: 'TypeError',
      code: null,
      codeStatus: 'unrecognized'
    });
    expect(startupErrorDetails(new RangeError('dummy-secret'))).toMatchObject({
      errorClass: 'RangeError',
      codeStatus: 'missing'
    });
    expect(startupErrorDetails(new SyntaxError('dummy-secret'))).toMatchObject({
      errorClass: 'SyntaxError',
      codeStatus: 'missing'
    });
    expect(startupErrorDetails('dummy-secret')).toMatchObject({ errorClass: 'NonError', code: null });
    expect(JSON.stringify(startupErrorDetails(error))).not.toContain('dummy-secret');
  });
  it('does not invoke error-code getters unsafely', () => {
    const error = Object.defineProperty(new Error('dummy-secret'), 'code', {
      get() {
        throw new Error('dummy-secret');
      }
    });
    expect(startupErrorDetails(error)).toMatchObject({ errorClass: 'Error', code: null, codeStatus: 'missing' });
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
