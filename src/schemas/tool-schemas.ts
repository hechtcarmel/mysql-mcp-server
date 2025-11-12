/**
 * Zod schemas for MCP tool input validation
 */

import { z } from 'zod';
import { MAX_QUERY_LENGTH } from '../constants.js';

/**
 * Response format enum
 */
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

/**
 * Input schema for mysql_query tool
 */
export const QueryInputSchema = z
  .object({
    query: z
      .string()
      .min(1, 'Query cannot be empty')
      .max(MAX_QUERY_LENGTH, `Query cannot exceed ${MAX_QUERY_LENGTH} characters`)
      .describe(
        'SQL query to execute. Must use fully qualified table names (database.table format). ' +
          'Examples: "SELECT * FROM mydb.users LIMIT 10", "SHOW TABLES FROM mydb", "DESCRIBE mydb.users"'
      ),

    response_format: z
      .enum(['markdown', 'json'])
      .default('markdown')
      .describe(
        'Output format: "markdown" for human-readable formatted output with tables (default), ' +
          'or "json" for machine-readable structured data with columns, rows, and metadata'
      )
  })
  .strict();

/**
 * Inferred type for query input
 */
export type QueryInput = z.infer<typeof QueryInputSchema>;
