import { QueryType, OperationMode, type ParseResult } from '../types.js';
import { MAX_QUERY_LENGTH, MAX_STATEMENTS } from '../constants.js';

interface Token {
  value: string;
  depth: number;
}
export interface Statement {
  sql: string;
  queryType: QueryType;
}

/** MySQL-aware lexical scanning keeps delimiters/comments inside literals intact. */
function scan(query: string): { sql: string; tokens: Token[] }[] {
  const statements: { sql: string; tokens: Token[] }[] = [];
  let tokens: Token[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < query.length; ) {
    const char = query[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === '#' || (query.startsWith('--', i) && /\s/.test(query[i + 2] ?? '\n'))) {
      const end = query.indexOf('\n', i);
      i = end < 0 ? query.length : end + 1;
      continue;
    }
    if (query.startsWith('/*', i)) {
      if (/^\/\*(?:!|M!)/i.test(query.slice(i))) throw new Error('Executable SQL comments are not allowed');
      const end = query.indexOf('*/', i + 2);
      if (end < 0) throw new Error('Unterminated SQL comment');
      i = end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      let closed = false;
      for (i++; i < query.length; i++) {
        if (query[i] === '\\' && quote !== '`') {
          i++;
          continue;
        }
        if (query[i] !== quote) continue;
        if (query[i + 1] === quote) {
          i++;
          continue;
        }
        i++;
        closed = true;
        break;
      }
      if (!closed) throw new Error('Unterminated SQL quote');
      tokens.push({ value: quote === '`' ? '<identifier>' : '<literal>', depth });
      continue;
    }
    if (char === ';' && depth === 0) {
      if (tokens.length) statements.push({ sql: query.slice(start, i).trim(), tokens });
      tokens = [];
      start = ++i;
      continue;
    }
    if (char === '(') {
      tokens.push({ value: char, depth });
      depth++;
      i++;
      continue;
    }
    if (char === ')') {
      if (--depth < 0) throw new Error('Unbalanced SQL parentheses');
      tokens.push({ value: char, depth });
      i++;
      continue;
    }
    const word = /^[a-zA-Z_][a-zA-Z_0-9$]*/.exec(query.slice(i));
    const value = word ? word[0].toUpperCase() : char;
    tokens.push({ value, depth });
    i += value.length;
  }
  if (depth !== 0) throw new Error('Unbalanced SQL parentheses');
  if (tokens.length) statements.push({ sql: query.slice(start).trim(), tokens });
  return statements;
}

const reads = new Set([QueryType.SELECT, QueryType.SHOW, QueryType.DESCRIBE, QueryType.EXPLAIN]);
const writes = new Set([QueryType.INSERT, QueryType.UPDATE, QueryType.DELETE, QueryType.REPLACE]);
const transactions = new Set([QueryType.START_TRANSACTION, QueryType.COMMIT, QueryType.ROLLBACK, QueryType.SAVEPOINT]);

function classify(tokens: Token[]): QueryType {
  let first = tokens[0]?.value;
  if (first === 'WITH') {
    // CTE bodies are parenthesized. Only the outer operation determines write access.
    first = tokens
      .slice(1)
      .find(
        token => token.depth === 0 && ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(token.value)
      )?.value;
  }
  if (first === 'DESC') return QueryType.DESCRIBE;
  if (first === 'BEGIN' || first === 'START') return QueryType.START_TRANSACTION;
  if (first === 'RELEASE') return QueryType.SAVEPOINT;
  return Object.values(QueryType).find(type => type === first) ?? QueryType.UNKNOWN;
}

export function validateQuery(query: string, mode: OperationMode): Statement[] {
  if (!query.trim() || query.length > MAX_QUERY_LENGTH)
    throw new Error(`Query must contain 1–${MAX_QUERY_LENGTH} characters`);
  const statements = scan(query);
  if (!statements.length) throw new Error('Empty SQL query');
  if (statements.length > MAX_STATEMENTS)
    throw new Error(`A query call may contain at most ${MAX_STATEMENTS} statements`);
  let inTransaction = false;
  return statements.map(({ sql, tokens }, index) => {
    const queryType = classify(tokens);
    if (
      !reads.has(queryType) &&
      !(mode === OperationMode.WRITE_ENABLED && (writes.has(queryType) || transactions.has(queryType)))
    ) {
      throw new Error(
        `${queryType} is not allowed in ${mode} mode. Writes require MYSQL_ALLOW_WRITE=true; DDL and administrative operations remain blocked.`
      );
    }
    const values = tokens.map(token => token.value);
    // These SELECT forms write files/session state, acquire locks, or call side-effecting functions.
    const forbidden = [
      'OUTFILE',
      'DUMPFILE',
      'GET_LOCK',
      'RELEASE_LOCK',
      'RELEASE_ALL_LOCKS',
      'SLEEP',
      'BENCHMARK',
      'LOAD_FILE'
    ];
    if (
      values.some(
        (value, i) => ['OUTFILE', 'DUMPFILE'].includes(value) || (forbidden.includes(value) && values[i + 1] === '(')
      ) ||
      values.some((value, i) => value === ':' && values[i + 1] === '=')
    ) {
      throw new Error(
        'SQL file access, session-variable assignments, locks, and side-effecting functions are not allowed'
      );
    }
    if (
      queryType === QueryType.SELECT &&
      (values.includes('INTO') ||
        values.includes('PROCEDURE') ||
        values.some(
          (value, i) =>
            (value === 'FOR' && ['UPDATE', 'SHARE'].includes(values[i + 1] ?? '')) ||
            (value === 'LOCK' && values[i + 1] === 'IN' && values[i + 2] === 'SHARE')
        ))
    ) {
      throw new Error('SELECT INTO, PROCEDURE, and locking SELECT forms are not allowed');
    }
    if (queryType === QueryType.EXPLAIN || queryType === QueryType.DESCRIBE) {
      if (values.includes('ANALYZE')) throw new Error('EXPLAIN ANALYZE executes SQL and is not allowed');
    }
    if (queryType === QueryType.START_TRANSACTION) {
      if (inTransaction || !/^(?:BEGIN(?: WORK)?|START TRANSACTION)$/.test(values.join(' '))) {
        throw new Error('Use BEGIN or START TRANSACTION once, followed by COMMIT or ROLLBACK in the same call');
      }
      inTransaction = true;
    } else if (transactions.has(queryType)) {
      if (!inTransaction)
        throw new Error('Transaction control must be inside a complete transaction in one mysql_query call');
      if ((queryType === QueryType.COMMIT || queryType === QueryType.ROLLBACK) && !values.includes('TO')) {
        if (!/^(?:COMMIT|ROLLBACK)(?: WORK)?$/.test(values.join(' ')))
          throw new Error('Transaction chaining is not supported');
        inTransaction = false;
      }
    }
    if (index === statements.length - 1 && inTransaction)
      throw new Error('Finish the transaction with COMMIT or ROLLBACK in the same mysql_query call');
    return { sql, queryType };
  });
}

export function parseQuery(query: string, mode: OperationMode): ParseResult {
  try {
    return { queryType: validateQuery(query, mode)[0]!.queryType, allowed: true };
  } catch (error) {
    return {
      queryType: QueryType.UNKNOWN,
      allowed: false,
      reason: error instanceof Error ? error.message : 'Invalid SQL'
    };
  }
}
