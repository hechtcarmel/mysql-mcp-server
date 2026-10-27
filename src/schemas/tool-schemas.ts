import { z } from 'zod';
import { MAX_QUERY_LENGTH } from '../constants.js';

export const QueryInputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(MAX_QUERY_LENGTH)
      .describe(
        'SQL query. Prefer fully qualified database.table names; otherwise MYSQL_DATABASE is used. Use LIMIT for exploratory queries.'
      ),
    response_format: z
      .enum(['markdown', 'json'])
      .default('markdown')
      .describe('Human-readable Markdown (default) or machine-readable JSON.')
  })
  .strict();
export type QueryInput = z.infer<typeof QueryInputSchema>;

export const QueryOutputSchema = z.object({
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(z.array(z.json())),
  metadata: z.object({
    rowCount: z.number(),
    executionTime: z.number(),
    truncated: z.boolean(),
    affectedRows: z.number().optional(),
    insertId: z.union([z.number(), z.string()]).optional(),
    changedRows: z.number().optional()
  }),
  results: z.array(z.json()).optional()
});
