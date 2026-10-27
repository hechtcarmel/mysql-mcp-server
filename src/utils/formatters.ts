import { type QueryResult, QueryType, type DatabaseInfo, type TableInfo, type TableSchema } from '../types.js';
import { CHARACTER_LIMIT } from '../constants.js';
import { QueryOutputSchema } from '../schemas/tool-schemas.js';
import type { z } from 'zod';

export type StructuredResult = z.infer<typeof QueryOutputSchema>;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function jsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return typeof value === 'symbol' ? (value.description ?? '') : '[unsupported value]';
}

export function toStructuredResult(result: QueryResult): StructuredResult {
  return {
    columns: result.columns ?? [],
    rows: (result.rows ?? []).map(row => row.map(jsonValue)),
    metadata: {
      rowCount: result.rowCount,
      executionTime: result.executionTime,
      truncated: result.truncated ?? false,
      ...(result.affectedRows !== undefined && { affectedRows: result.affectedRows }),
      ...(result.insertId !== undefined && { insertId: result.insertId }),
      ...(result.changedRows !== undefined && { changedRows: result.changedRows })
    },
    ...(result.results && { results: result.results.map(item => jsonValue(toStructuredResult(item))) })
  };
}

export function formatAsJSON(result: QueryResult): string {
  return JSON.stringify(toStructuredResult(result), null, 2);
}

function escapeCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? 'NULL'
      : typeof value === 'string'
        ? value
        : JSON.stringify(jsonValue(value));
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '&#92;')
    .replace(/\|/g, '&#124;')
    .replace(/`/g, '&#96;')
    .replace(/\r?\n/g, '<br>');
}

function markdown(result: StructuredResult): string {
  if (result.results)
    return result.results
      .map((item, i) => `### Statement ${i + 1}\n\n${markdown(QueryOutputSchema.parse(item))}`)
      .join('\n\n');
  let output: string;
  if (result.metadata.affectedRows !== undefined) {
    output = `**Operation completed successfully**\n\n- Rows affected: ${result.metadata.affectedRows}\n- Insert ID: ${result.metadata.insertId ?? 0}\n`;
  } else if (!result.rows.length) output = '**No rows returned**\n';
  else {
    output = '| ' + result.columns.map(column => escapeCell(column.name)).join(' | ') + ' |\n';
    output += '| ' + result.columns.map(() => '---').join(' | ') + ' |\n';
    output += result.rows.map(row => '| ' + row.map(escapeCell).join(' | ') + ' |').join('\n');
    output += `\n\n**Query completed:** ${result.rows.length} row(s) returned in ${result.metadata.executionTime}ms\n`;
  }
  if (result.metadata.truncated) output += '\n**Response truncated.** Use LIMIT, filters, or fewer columns.\n';
  return output;
}

export function formatAsMarkdown(result: QueryResult, _queryType: QueryType): string {
  return markdown(toStructuredResult(result));
}

/** Trim whole rows and retain a valid output object in both legacy text formats. */
export function formatQueryResponse(
  result: QueryResult,
  format: 'markdown' | 'json'
): { text: string; structuredContent: StructuredResult } {
  const output = toStructuredResult(result);
  const render = (): string => (format === 'json' ? JSON.stringify(output, null, 2) : markdown(output));
  // The structured payload has its own budget so Markdown escaping cannot hide oversized data.
  while (render().length > CHARACTER_LIMIT || JSON.stringify(output).length > CHARACTER_LIMIT) {
    output.metadata.truncated = true;
    const items = output.results ? output.results.map(item => QueryOutputSchema.parse(item)) : [output];
    let changed = false;
    for (const item of items) {
      item.metadata.truncated = true;
      if (item.rows.length) {
        item.rows.length = Math.floor(item.rows.length / 2);
        item.metadata.rowCount = item.rows.length;
        changed = true;
      } else if (item.columns.length) {
        item.columns.length = Math.floor(item.columns.length / 2);
        changed = true;
      }
    }
    if (output.results) {
      output.results = items.map(jsonValue);
      const first = items[0]!;
      output.rows = first.rows;
      output.columns = first.columns;
      output.metadata.rowCount = first.metadata.rowCount;
    }
    if (!changed) throw new Error('Query response metadata exceeds the response limit');
  }
  return { text: render(), structuredContent: output };
}

export function applyCharacterLimit(response: string, includeWarning = true): string {
  if (response.length <= CHARACTER_LIMIT) return response;
  const warning = includeWarning ? '\n\n**Response truncated.** Use a narrower resource or query.\n' : '';
  return response.slice(0, CHARACTER_LIMIT - warning.length) + warning;
}

/**
 * Format database list as Markdown
 */
export function formatDatabaseListAsMarkdown(databases: DatabaseInfo[]): string {
  let output = `# Databases\n\n`;
  output += `Total: ${databases.length} database(s)\n\n`;

  if (databases.length === 0) {
    return output + '*No accessible databases found*\n';
  }

  output += '| Name | Character Set | Collation | Tables |\n';
  output += '| --- | --- | --- | --- |\n';

  for (const db of databases) {
    output += `| ${escapeCell(db.name)} | ${escapeCell(db.defaultCharacterSet)} | ${escapeCell(db.defaultCollation)} | ${escapeCell(db.tableCount)} |\n`;
  }

  return output;
}

/**
 * Format database info as Markdown
 */
export function formatDatabaseAsMarkdown(
  db: { name: string; characterSet: string; collation: string },
  tables: TableInfo[]
): string {
  let output = `# Database: ${db.name}\n\n`;
  output += `**Character Set:** ${db.characterSet}\n`;
  output += `**Collation:** ${db.collation}\n\n`;
  output += `## Tables (${tables.length})\n\n`;

  if (tables.length === 0) {
    return output + '*No tables found in this database*\n';
  }

  output += '| Name | Type | Engine | Rows | Data Size | Index Size | Comment |\n';
  output += '| --- | --- | --- | --- | --- | --- | --- |\n';

  for (const table of tables) {
    const dataSize = formatBytes(table.dataLength);
    const indexSize = formatBytes(table.indexLength);
    const comment = table.comment || '-';
    output += `| ${escapeCell(table.name)} | ${escapeCell(table.type)} | ${escapeCell(table.engine || '-')} | ${escapeCell(table.rowCount)} | ${escapeCell(dataSize)} | ${escapeCell(indexSize)} | ${escapeCell(comment)} |\n`;
  }

  return output;
}

/**
 * Format table schema as Markdown
 */
export function formatTableSchemaAsMarkdown(schema: TableSchema): string {
  let output = `# Table: ${schema.table.database}.${schema.table.name}\n\n`;

  // Table info
  output += `## Table Information\n\n`;
  output += `- **Type:** ${schema.table.type}\n`;
  output += `- **Engine:** ${schema.table.engine || 'N/A'}\n`;
  output += `- **Row Format:** ${schema.table.rowFormat || 'N/A'}\n`;
  output += `- **Rows:** ${schema.table.rowCount}\n`;
  output += `- **Data Size:** ${formatBytes(schema.table.dataLength)}\n`;
  output += `- **Index Size:** ${formatBytes(schema.table.indexLength)}\n`;
  if (schema.table.autoIncrement) {
    output += `- **Auto Increment:** ${schema.table.autoIncrement}\n`;
  }
  if (schema.table.createTime) {
    output += `- **Created:** ${schema.table.createTime.toISOString()}\n`;
  }
  if (schema.table.updateTime) {
    output += `- **Updated:** ${schema.table.updateTime.toISOString()}\n`;
  }
  if (schema.table.comment) {
    output += `- **Comment:** ${schema.table.comment}\n`;
  }
  output += '\n';

  // Columns
  output += `## Columns (${schema.columns.length})\n\n`;
  output += '| # | Name | Type | Nullable | Key | Default | Extra | Comment |\n';
  output += '| --- | --- | --- | --- | --- | --- | --- | --- |\n';

  for (const col of schema.columns) {
    const nullable = col.isNullable ? 'YES' : 'NO';
    const defaultVal = col.defaultValue !== null ? col.defaultValue : '-';
    const extra = col.extra || '-';
    const comment = col.comment || '-';
    output += `| ${escapeCell(col.ordinalPosition)} | ${escapeCell(col.name)} | ${escapeCell(col.columnType)} | ${escapeCell(nullable)} | ${escapeCell(col.columnKey || '-')} | ${escapeCell(defaultVal)} | ${escapeCell(extra)} | ${escapeCell(comment)} |\n`;
  }
  output += '\n';

  // Indexes
  if (schema.indexes.length > 0) {
    output += `## Indexes (${schema.indexes.length})\n\n`;
    output += '| Name | Unique | Columns | Type | Comment |\n';
    output += '| --- | --- | --- | --- | --- |\n';

    for (const idx of schema.indexes) {
      const unique = idx.unique ? 'YES' : 'NO';
      const columns = idx.columns.join(', ');
      const comment = idx.comment || '-';
      output += `| ${escapeCell(idx.name)} | ${escapeCell(unique)} | ${escapeCell(columns)} | ${escapeCell(idx.indexType)} | ${escapeCell(comment)} |\n`;
    }
    output += '\n';
  }

  // Foreign keys
  if (schema.foreignKeys.length > 0) {
    output += `## Foreign Keys (${schema.foreignKeys.length})\n\n`;
    output += '| Name | Columns | References | On Update | On Delete |\n';
    output += '| --- | --- | --- | --- | --- |\n';

    for (const fk of schema.foreignKeys) {
      const columns = fk.columns.join(', ');
      const refs = `${fk.referencedTable}(${fk.referencedColumns.join(', ')})`;
      output += `| ${escapeCell(fk.name)} | ${escapeCell(columns)} | ${escapeCell(refs)} | ${escapeCell(fk.onUpdate)} | ${escapeCell(fk.onDelete)} |\n`;
    }
    output += '\n';
  }

  return output;
}

/**
 * Format bytes as human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
