import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/services/config-loader.js';
import { OperationMode } from '../src/types.js';

const env = { MYSQL_HOST: 'localhost', MYSQL_USER: 'test', MYSQL_PASSWORD: 'secret' };
describe('configuration compatibility and safe defaults', () => {
  it('keeps all existing defaults', () => {
    expect(parseConfig(env)).toEqual({
      ...envToConfig(),
      operationMode: OperationMode.READ_ONLY,
      port: 3306,
      poolSize: 10,
      connectionTimeout: 10000,
      queryTimeout: 30000,
      maxRows: 1000
    });
  });
  it('preserves environment names, database selection and case-insensitive boolean values', () => {
    expect(
      parseConfig({ ...env, MYSQL_ALLOW_WRITE: 'TRUE', MYSQL_DATABASE: 'shop', MYSQL_PORT: '3307' })
    ).toMatchObject({ operationMode: OperationMode.WRITE_ENABLED, database: 'shop', port: 3307 });
  });
  it.each(['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD'])('requires %s without echoing credentials', name => {
    expect(() => parseConfig({ ...env, [name]: '' })).toThrow(name);
    expect(() => parseConfig({ ...env, [name]: '' })).not.toThrow('secret');
  });
  it.each(['1', 'yes', 'truthy', ' true '])('fails closed for ambiguous write flag %s', value => {
    expect(() => parseConfig({ ...env, MYSQL_ALLOW_WRITE: value })).toThrow('MYSQL_ALLOW_WRITE');
  });
  it.each(['3306foo', '1.5', '-1', 'Infinity', '0', '65536', '1e3'])('rejects invalid ports %s', value => {
    expect(() => parseConfig({ ...env, MYSQL_PORT: value })).toThrow('MYSQL_PORT');
  });
  it('enables TLS with system trust without requiring custom certificate files', () => {
    expect(parseConfig({ ...env, MYSQL_SSL: 'true' }).ssl).toEqual({ rejectUnauthorized: true });
  });
  it('requires a matched client cert and key', () => {
    expect(() => parseConfig({ ...env, MYSQL_SSL_CERT: '/missing' })).toThrow('configured together');
  });
  it('does not echo TLS contents or paths on read failures', () => {
    expect(() => parseConfig({ ...env, MYSQL_SSL_CA: '/private/path' })).toThrow(
      'Could not read configured MySQL TLS files'
    );
  });
});
function envToConfig() {
  return { host: 'localhost', user: 'test', password: 'secret' };
}
