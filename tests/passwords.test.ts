import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, parseConfig } from '../src/services/config-loader.js';

// Dummy strings only. These tests never attempt database authentication.
export const passwords = [
  '!bang!',
  'hash#inside',
  '$dollar${literal}',
  "single'quote",
  'double"quote',
  String.raw`back\slash\n`,
  'at@colon:percent%',
  ' leading and trailing spaces ',
  'עברית🔒日本語',
  'both\'and"quotes'
];
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const base = { MYSQL_HOST: 'test', MYSQL_USER: 'test' };
function quoted(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return '`' + value + '`';
}
describe('literal password preservation', () => {
  it.each(passwords)('preserves direct environment and JSON config bytes for %s', password => {
    const env = { ...base, MYSQL_PASSWORD: password };
    expect(parseConfig(env).password).toBe(password);
    expect(parseConfig(JSON.parse(JSON.stringify(env))).password).toBe(password);
  });
  it.each(passwords)('preserves quoted dotenv bytes for %s', password => {
    const directory = mkdtempSync(join(tmpdir(), 'mysql-password-'));
    directories.push(directory);
    const file = join(directory, '.env');
    writeFileSync(file, `MYSQL_HOST=test\nMYSQL_USER=test\nMYSQL_PASSWORD=${quoted(password)}\n`, { mode: 0o600 });
    expect(loadConfig({ MYSQL_ENV_FILE: file }, directory).password).toBe(password);
  });
  it('reproduces unquoted # truncation as dotenv syntax, and preserves it when quoted', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mysql-password-'));
    directories.push(directory);
    const file = join(directory, '.env');
    writeFileSync(file, 'MYSQL_PASSWORD=dummy#suffix\n');
    expect(loadConfig({ ...base, MYSQL_ENV_FILE: file }, directory).password).toBe('dummy');
    writeFileSync(file, "MYSQL_PASSWORD='dummy#suffix'\n");
    expect(loadConfig({ ...base, MYSQL_ENV_FILE: file }, directory).password).toBe('dummy#suffix');
  });
});
