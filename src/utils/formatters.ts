/**
 * Response formatters for query results and resources
 */

import { QueryResult, QueryType, DatabaseInfo, TableInfo, TableSchema } from '../types.js';
import { CHARACTER_LIMIT } from '../constants.js';

/**
 * Format query result as JSON
 */
export function formatAsJSON(result: QueryResult): string {
  const output = {
    columns: result.columns || [],
    rows: result.rows || [],
    metadata: {
      rowCount: result.rowCount,
      executionTime: result.executionTime,
      truncated: result.truncated || false,
      ...(result.affectedRows !== undefined && { affectedRows: result.affectedRows }),
      ...(result.insertId !== undefined && { insertId: result.insertId }),
      ...(result.changedRows !== undefined && { changedRows: result.changedRows })
    }
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Format query result as Markdown
 */
export function formatAsMarkdown(result: QueryResult, _queryType: QueryType): string {
  let output = '';

  // For SELECT-like queries with result sets
  if (result.columns && result.rows && result.rows.length > 0) {
    output += formatMarkdownTable(result.columns, result.rows);
    output += '\n\n';
    output += `**Query completed:** ${result.rowCount} row(s) returned in ${result.executionTime}ms\n`;
  }
  // For SELECT with no results
  else if (result.columns && result.rows && result.rows.length === 0) {
    output += '**No rows returned**\n\n';
    output += `Query completed in ${result.executionTime}ms\n`;
  }
  // For DML operations (INSERT, UPDATE, DELETE)
  else if (result.affectedRows !== undefined) {
    output += formatDMLResult(result);
  }
  // For other operations
  else {
    output += `**Query completed** in ${result.executionTime}ms\n`;
    if (result.rowCount > 0) {
      output += `${result.rowCount} row(s) affected\n`;
    }
  }

  return output;
}

/**
 * Format result set as Markdown table
 */
function formatMarkdownTable(columns: Array<{ name: string; type: string }>, rows: unknown[][]): string {
  if (columns.length === 0 || rows.length === 0) {
    return '*(Empty result set)*';
  }

  let table = '';

  // Header row
  table += '| ' + columns.map(col => col.name).join(' | ') + ' |\n';

  // Separator row
  table += '| ' + columns.map(() => '---').join(' | ') + ' |\n';

  // Data rows
  for (const row of rows) {
    const formattedRow = row.map(cell => formatCell(cell));
    table += '| ' + formattedRow.join(' | ') + ' |\n';
  }

  return table;
}

/**
 * Format a cell value for display
 */
function formatCell(value: unknown): string {
  if (value === null) {
    return '*NULL*';
  }
  if (value === undefined) {
    return '*undefined*';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Format DML operation result
 */
function formatDMLResult(result: QueryResult): string {
  let output = '**Operation completed successfully**\n\n';

  if (result.affectedRows !== undefined) {
    output += `- Rows affected: ${result.affectedRows}\n`;
  }
  if (result.insertId !== undefined && result.insertId > 0) {
    output += `- Insert ID: ${result.insertId}\n`;
  }
  if (result.changedRows !== undefined) {
    output += `- Rows changed: ${result.changedRows}\n`;
  }

  output += `- Execution time: ${result.executionTime}ms\n`;

  return output;
}

/**
 * Apply character limit truncation to response
 */
export function applyCharacterLimit(response: string, includeWarning: boolean = true): string {
  if (response.length <= CHARACTER_LIMIT) {
    return response;
  }

  const truncated = response.substring(0, CHARACTER_LIMIT);

  if (!includeWarning) {
    return truncated;
  }

  const warning = `\n\n---\n**⚠️ Response Truncated**\n\n` +
    `The response was truncated at ${CHARACTER_LIMIT} characters. ` +
    `Original length was ${response.length} characters.\n\n` +
    `**Suggestions to reduce response size:**\n` +
    `- Add a LIMIT clause to restrict the number of rows (e.g., LIMIT 100)\n` +
    `- Use WHERE clauses to filter data more specifically\n` +
    `- Select only necessary columns instead of using SELECT *\n` +
    `- Consider breaking your query into smaller, more focused queries\n`;

  // Make sure we have room for the warning
  const maxContentLength = CHARACTER_LIMIT - warning.length;
  if (maxContentLength > 0 && truncated.length > maxContentLength) {
    return response.substring(0, maxContentLength) + warning;
  }

  return truncated + warning;
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
    output += `| ${db.name} | ${db.defaultCharacterSet} | ${db.defaultCollation} | ${db.tableCount} |\n`;
  }

  return output;
}

/**
 * Format database info as Markdown
 */
export function formatDatabaseAsMarkdown(db: { name: string; characterSet: string; collation: string }, tables: TableInfo[]): string {
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
    output += `| ${table.name} | ${table.type} | ${table.engine || '-'} | ${table.rowCount} | ${dataSize} | ${indexSize} | ${comment} |\n`;
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
    output += `| ${col.ordinalPosition} | ${col.name} | ${col.columnType} | ${nullable} | ${col.columnKey || '-'} | ${defaultVal} | ${extra} | ${comment} |\n`;
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
      output += `| ${idx.name} | ${unique} | ${columns} | ${idx.indexType} | ${comment} |\n`;
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
      output += `| ${fk.name} | ${columns} | ${refs} | ${fk.onUpdate} | ${fk.onDelete} |\n`;
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
