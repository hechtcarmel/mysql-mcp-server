import { describe, expect, it } from 'vitest';
import { formatQueryResponse } from '../src/utils/formatters.js';
import { QueryOutputSchema } from '../src/schemas/tool-schemas.js';
import { CHARACTER_LIMIT } from '../src/constants.js';
import type { QueryResult } from '../src/types.js';

const result: QueryResult = { columns: [{ name: 'id', type: 'LONG' }], rows: [[1]], rowCount: 1, executionTime: 2 };
describe('legacy text and structured responses', () => {
  it('preserves the JSON envelope and adds matching structured content', () => {
    const formatted = formatQueryResponse(result, 'json');
    expect(JSON.parse(formatted.text)).toEqual(formatted.structuredContent);
    expect(formatted.structuredContent).toEqual({
      columns: result.columns,
      rows: [[1]],
      metadata: { rowCount: 1, executionTime: 2, truncated: false }
    });
  });
  it.each(['markdown', 'json'] as const)('bounds %s without cutting values or invalidating JSON', format => {
    const large = { ...result, rows: Array.from({ length: 1000 }, () => ['x'.repeat(1000)]), rowCount: 1000 };
    const formatted = formatQueryResponse(large, format);
    expect(formatted.text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(JSON.stringify(formatted.structuredContent).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(QueryOutputSchema.safeParse(formatted.structuredContent).success).toBe(true);
    expect(formatted.structuredContent.metadata.truncated).toBe(true);
    expect(formatted.structuredContent.metadata.rowCount).toBe(formatted.structuredContent.rows.length);
    if (format === 'json') expect(JSON.parse(formatted.text)).toEqual(formatted.structuredContent);
  });
  it('escapes Markdown headers, pipes, HTML and newlines', () => {
    const formatted = formatQueryResponse(
      { ...result, columns: [{ name: 'x|y', type: 'STRING' }], rows: [['<script>\nx|y`']] },
      'markdown'
    );
    expect(formatted.text).toContain('x&#124;y');
    expect(formatted.text).toContain('&lt;script&gt;<br>x&#124;y&#96;');
  });
  it('keeps bigint precision and serializes binary, dates, JSON, and nulls', () => {
    const values = [9007199254740993n, Buffer.from('hello'), new Date('2026-01-01Z'), { a: 1 }, null];
    expect(formatQueryResponse({ ...result, rows: [values] }, 'json').structuredContent.rows[0]).toEqual([
      '9007199254740993',
      'aGVsbG8=',
      '2026-01-01T00:00:00.000Z',
      { a: 1 },
      null
    ]);
  });
  it('reports truncation for a single oversized row', () => {
    const output = formatQueryResponse({ ...result, rows: [['x'.repeat(50000)]] }, 'json').structuredContent;
    expect(output.rows).toEqual([]);
    expect(output.metadata.truncated).toBe(true);
  });
  it('preserves DML and empty result metadata', () => {
    expect(
      formatQueryResponse({ affectedRows: 3, insertId: 4, rowCount: 3, executionTime: 2 }, 'json').structuredContent
        .metadata
    ).toMatchObject({ affectedRows: 3, insertId: 4, rowCount: 3 });
    expect(formatQueryResponse({ ...result, rows: [], rowCount: 0 }, 'markdown').text).toContain('No rows');
  });
  it('bounds batch results and returns every statement in order', () => {
    const big = { ...result, rows: Array.from({ length: 100 }, () => ['x'.repeat(1000)]), rowCount: 100 };
    const output = formatQueryResponse({ ...big, results: [big, big] }, 'json');
    expect(output.text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(output.structuredContent.results).toHaveLength(2);
  });
});
