import { describe, expect, it } from 'vitest';
import { parseQuery, validateQuery } from '../src/services/query-parser.js';
import { OperationMode as Mode, QueryType } from '../src/types.js';

const reads = [
  'SELECT 1',
  'SELECT @@version, @@global.read_only',
  'SELECT sleep FROM shop.settings',
  "SELECT * FROM JSON_TABLE('[1]', '$[*]' COLUMNS (id FOR ORDINALITY)) AS j",
  'SELECT @my_variable',
  'select * from shop.orders LIMIT 5;',
  'SELECT * FROM orders',
  "SELECT ';', '-- not a comment', '/* literal */', '# literal'",
  "SELECT 'it''s; safe'",
  'SELECT `semi;colon`, `escaped``identifier` FROM shop.orders',
  '# comment\nSELECT 1',
  '-- comment\nSELECT 1',
  '/* comment */ SELECT 1',
  'SHOW DATABASES',
  'SHOW TABLES FROM shop',
  'DESC shop.orders',
  'DESCRIBE shop.orders',
  'EXPLAIN SELECT * FROM shop.orders',
  'WITH recent AS (SELECT * FROM shop.orders) SELECT * FROM recent',
  'WITH RECURSIVE seq AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM seq WHERE n<5) SELECT * FROM seq',
  'SELECT 1; SELECT 2;'
];
const dangerous = [
  'DROP TABLE shop.orders',
  'TRUNCATE shop.orders',
  'GRANT ALL ON *.* TO test',
  'CREATE TABLE shop.evil (id int)',
  'ALTER TABLE shop.orders ADD x int',
  'SET GLOBAL read_only=0',
  'USE shop',
  "LOAD DATA LOCAL INFILE '/tmp/x' INTO TABLE shop.orders",
  'CALL shop.evil()',
  "SELECT * FROM shop.orders INTO OUTFILE '/tmp/x'",
  "SELECT 1 INTO DUMPFILE '/tmp/x'",
  "SELECT GET_LOCK('x', 1)",
  "SELECT RELEASE_LOCK('x')",
  'SELECT RELEASE_ALL_LOCKS()',
  'SELECT SLEEP(10)',
  'SELECT BENCHMARK(10, 1)',
  "SELECT LOAD_FILE('/etc/passwd')",
  'SELECT @a := 1',
  'SELECT * FROM shop.orders FOR UPDATE',
  'SELECT * FROM shop.orders LOCK IN SHARE MODE',
  'EXPLAIN ANALYZE SELECT 1',
  'DESC ANALYZE SELECT 1',
  'SELECT 1; DROP TABLE shop.orders',
  "SELECT 1 /*! INTO OUTFILE '/tmp/x' */",
  "SELECT 1 /*M! INTO OUTFILE '/tmp/x' */",
  'SELECT 1 /* unterminated',
  "SELECT 'unterminated",
  'SELECT (1',
  'SELECT 1)',
  '',
  '/* just a comment */',
  'nonsense'
];
describe('SQL validation', () => {
  it.each(reads)('accepts compatible read SQL: %s', sql => {
    expect(parseQuery(sql, Mode.READ_ONLY).allowed).toBe(true);
  });
  it.each(dangerous)('rejects unsafe or malformed SQL in both modes: %s', sql => {
    expect(parseQuery(sql, Mode.READ_ONLY).allowed).toBe(false);
    expect(parseQuery(sql, Mode.WRITE_ENABLED).allowed).toBe(false);
  });
  it.each([
    'INSERT INTO shop.orders VALUES (1)',
    'UPDATE shop.orders SET id=2',
    'DELETE FROM shop.orders',
    'REPLACE INTO shop.orders VALUES (1)',
    'WITH c AS (SELECT 1) UPDATE shop.orders SET id=2',
    'WITH c AS (SELECT 1) DELETE FROM shop.orders'
  ])('gates the outer DML operation: %s', sql => {
    expect(parseQuery(sql, Mode.READ_ONLY).allowed).toBe(false);
    expect(parseQuery(sql, Mode.WRITE_ENABLED).allowed).toBe(true);
  });
  it('keeps a semicolon and comment markers inside a string in one statement', () => {
    const sql = "SELECT 'value; -- comment /* still a string */' AS value; SELECT 2";
    expect(validateQuery(sql, Mode.READ_ONLY)).toHaveLength(2);
    expect(validateQuery(sql, Mode.READ_ONLY)[0]?.sql).toContain('value; -- comment');
  });
  it('checks the entire batch before execution', () => {
    expect(() =>
      validateQuery('INSERT INTO shop.orders VALUES (1); DROP TABLE shop.orders', Mode.WRITE_ENABLED)
    ).toThrow('DROP');
  });
  it('accepts complete transactions with savepoints in a single call', () => {
    const statements = validateQuery(
      'START TRANSACTION; INSERT INTO shop.orders VALUES (1); SAVEPOINT s; ROLLBACK TO s; RELEASE SAVEPOINT s; COMMIT',
      Mode.WRITE_ENABLED
    );
    expect(statements[0]?.queryType).toBe(QueryType.START_TRANSACTION);
    expect(statements).toHaveLength(6);
  });
  it.each([
    'START TRANSACTION',
    'BEGIN; SELECT 1',
    'COMMIT',
    'ROLLBACK',
    'BEGIN; BEGIN; COMMIT',
    'BEGIN; COMMIT AND CHAIN'
  ])('rejects session-leaking transaction SQL %s', sql => {
    expect(() => validateQuery(sql, Mode.WRITE_ENABLED)).toThrow();
  });
  it('accepts transaction comments and enforces the batch limit', () => {
    expect(validateQuery('/* start */ BEGIN; SELECT 1; COMMIT /* end */', Mode.WRITE_ENABLED)).toHaveLength(3);
    expect(() => validateQuery('SELECT 1;'.repeat(51), Mode.READ_ONLY)).toThrow('50 statements');
  });
  it('enforces the length limit on every execution path', () => {
    expect(parseQuery('SELECT ' + 'x'.repeat(10000), Mode.READ_ONLY).allowed).toBe(false);
  });
});
