import { z } from 'zod';
import { MAX_QUERY_LENGTH } from '../constants.js';

export const QueryInputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(MAX_QUERY_LENGTH)
      .describe(
        'MySQL SQL. Prefer database.table names; unqualified names use MYSQL_DATABASE. Add LIMIT to bound database work.'
      )
      .meta({ examples: ['SELECT id FROM shop.orders ORDER BY id LIMIT 10'] }),
    response_format: z
      .enum(['markdown', 'json'])
      .default('markdown')
      .describe('Text rendering: Markdown (default) or JSON. Both also return structuredContent.')
  })
  .strict();
export type QueryInput = z.infer<typeof QueryInputSchema>;

export const QueryResultOutputSchema = z.object({
  columns: z
    .array(
      z.object({
        name: z.string().describe('Column label; duplicate labels keep separate positions.'),
        type: z.string().describe('MySQL protocol type name, not the full SQL column declaration.')
      })
    )
    .describe('Ordered columns for row results; empty for statements without a row set.'),
  rows: z
    .array(z.array(z.json()))
    .describe('Values by column position. Large integers and DECIMAL are strings; binary is base64; SQL NULL is null.'),
  metadata: z.object({
    rowCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Retained row count, or MySQL affected rows for a statement without a row set.'),
    executionTime: z.number().nonnegative().describe('Elapsed request execution time in milliseconds.'),
    truncated: z.boolean().describe('Rows or column metadata were omitted; use filters, LIMIT or fewer columns.'),
    affectedRows: z
      .number()
      .nonnegative()
      .optional()
      .describe('MySQL-reported affected rows; not necessarily changed rows.'),
    insertId: z.union([z.number(), z.string()]).optional().describe('MySQL insert ID; large IDs may be strings.'),
    changedRows: z.number().nonnegative().optional().describe('Driver-reported changed rows; zero when unavailable.')
  })
});
export const QueryOutputSchema = QueryResultOutputSchema.extend({
  results: z
    .array(QueryResultOutputSchema)
    .optional()
    .describe(
      'Batch outputs in execution order. Top-level fields describe the first statement; top-level truncated summarizes the batch.'
    )
});
