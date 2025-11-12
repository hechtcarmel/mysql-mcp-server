/**
 * Error handling utilities
 */

import { ZodError } from 'zod';

/**
 * MySQL error interface
 */
interface MySQLError {
  code?: string;
  errno?: number;
  sqlMessage?: string;
  sqlState?: string;
  sql?: string;
}

/**
 * Check if error is a MySQL error
 */
function isMySQLError(error: unknown): error is MySQLError {
  return (
    typeof error === 'object' && error !== null && 'code' in error && typeof (error as MySQLError).code === 'string'
  );
}

/**
 * Check if error is a timeout error
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('timeout') || error.message.includes('ETIMEDOUT');
  }
  return false;
}

/**
 * Handle MySQL errors with helpful messages
 */
export function handleMySQLError(error: unknown): string {
  if (!isMySQLError(error)) {
    return handleUnknownError(error);
  }

  const mysqlError = error;

  switch (mysqlError.code) {
    case 'ER_NO_SUCH_TABLE':
      return (
        `**Error: Table does not exist**\n\n` +
        `${mysqlError.sqlMessage || 'The specified table was not found.'}\n\n` +
        `**Suggestions:**\n` +
        `- Verify the table name is spelled correctly\n` +
        `- Ensure you're using fully qualified names (database.table format)\n` +
        `- Use SHOW TABLES FROM database_name to see available tables\n` +
        `- Check that you have permissions to access this table\n`
      );

    case 'ER_BAD_DB_ERROR':
      return (
        `**Error: Database does not exist**\n\n` +
        `${mysqlError.sqlMessage || 'The specified database was not found.'}\n\n` +
        `**Suggestions:**\n` +
        `- Verify the database name is spelled correctly\n` +
        `- Use SHOW DATABASES to see available databases\n` +
        `- Check that you have permissions to access this database\n`
      );

    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_TABLEACCESS_DENIED_ERROR':
    case 'ER_DBACCESS_DENIED_ERROR':
      return (
        `**Error: Access denied**\n\n` +
        `${mysqlError.sqlMessage || 'You do not have permission for this operation.'}\n\n` +
        `Your MySQL user account does not have the required permissions for this operation.\n\n` +
        `**Suggestions:**\n` +
        `- Contact your database administrator to grant appropriate permissions\n` +
        `- Verify you're connecting with the correct MySQL user account\n` +
        `- Check that your user has been granted access to the specific database/table\n`
      );

    case 'ER_PARSE_ERROR':
    case 'ER_SYNTAX_ERROR':
      return (
        `**Error: SQL syntax error**\n\n` +
        `${mysqlError.sqlMessage || 'There is an error in your SQL syntax.'}\n\n` +
        `**Suggestions:**\n` +
        `- Check your query syntax carefully\n` +
        `- Ensure table names are fully qualified (database.table format)\n` +
        `- Verify column names and keywords are spelled correctly\n` +
        `- Make sure quotes and parentheses are balanced\n`
      );

    case 'ER_DUP_ENTRY':
      return (
        `**Error: Duplicate entry**\n\n` +
        `${mysqlError.sqlMessage || 'A duplicate value was found.'}\n\n` +
        `This typically occurs when trying to insert a row that violates a unique constraint or primary key.\n\n` +
        `**Suggestions:**\n` +
        `- Check for existing records before inserting\n` +
        `- Use INSERT IGNORE or REPLACE to handle duplicates\n` +
        `- Modify your data to ensure unique values\n`
      );

    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return (
        `**Error: Foreign key constraint violation**\n\n` +
        `${mysqlError.sqlMessage || 'Referenced row does not exist.'}\n\n` +
        `The operation violates a foreign key constraint - the referenced row must exist first.\n\n` +
        `**Suggestions:**\n` +
        `- Ensure the referenced record exists in the parent table\n` +
        `- Check that foreign key values match existing primary key values\n`
      );

    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return (
        `**Error: Cannot delete or update**\n\n` +
        `${mysqlError.sqlMessage || 'Row is referenced by other records.'}\n\n` +
        `The row cannot be deleted or updated because other records reference it.\n\n` +
        `**Suggestions:**\n` +
        `- Delete child records first\n` +
        `- Consider using CASCADE delete if appropriate\n` +
        `- Update foreign keys in dependent tables\n`
      );

    case 'ER_LOCK_WAIT_TIMEOUT':
      return (
        `**Error: Lock wait timeout exceeded**\n\n` +
        `The query waited too long to acquire a table lock.\n\n` +
        `**Suggestions:**\n` +
        `- Try the query again - another transaction may be holding the lock\n` +
        `- Check for long-running queries that might be blocking this operation\n` +
        `- Consider using smaller transactions\n` +
        `- Contact your database administrator if the issue persists\n`
      );

    case 'ER_LOCK_DEADLOCK':
      return (
        `**Error: Deadlock detected**\n\n` +
        `${mysqlError.sqlMessage || 'A deadlock was detected and the transaction was rolled back.'}\n\n` +
        `**Suggestions:**\n` +
        `- Retry the operation - deadlocks are typically transient\n` +
        `- Consider reordering operations to avoid deadlocks\n` +
        `- Keep transactions small and quick\n`
      );

    case 'ER_TOO_MANY_CONNECTIONS':
      return (
        `**Error: Too many connections**\n\n` +
        `The MySQL server has reached its connection limit.\n\n` +
        `**Suggestions:**\n` +
        `- Wait a moment and try again\n` +
        `- Contact your database administrator to increase max_connections\n` +
        `- Check for connection leaks in applications\n`
      );

    case 'ECONNREFUSED':
      return (
        `**Error: Connection refused**\n\n` +
        `Unable to connect to the MySQL server.\n\n` +
        `**Suggestions:**\n` +
        `- Verify the MySQL server is running\n` +
        `- Check that MYSQL_HOST and MYSQL_PORT are correct\n` +
        `- Ensure there are no firewall rules blocking the connection\n` +
        `- Verify network connectivity to the database server\n`
      );

    case 'PROTOCOL_CONNECTION_LOST':
    case 'ECONNRESET':
      return (
        `**Error: Connection lost**\n\n` +
        `The connection to the MySQL server was lost.\n\n` +
        `**Suggestions:**\n` +
        `- Check your network connection\n` +
        `- Verify the MySQL server is running\n` +
        `- Try the query again\n` +
        `- Check MySQL server logs for issues\n`
      );

    default:
      return (
        `**MySQL Error (${mysqlError.code})**\n\n` +
        `${mysqlError.sqlMessage || 'An error occurred while executing the query.'}\n\n` +
        (mysqlError.sql ? `**Query:**\n\`\`\`sql\n${mysqlError.sql}\n\`\`\`\n\n` : '') +
        `If this error persists, consult the MySQL documentation or contact your database administrator.\n`
      );
  }
}

/**
 * Handle timeout errors
 */
export function handleTimeoutError(queryTimeout: number): string {
  return (
    `**Error: Query execution timeout**\n\n` +
    `The query exceeded the timeout limit of ${queryTimeout}ms.\n\n` +
    `**Suggestions to resolve:**\n` +
    `- Add a LIMIT clause to reduce the result set size (e.g., LIMIT 100)\n` +
    `- Add WHERE clauses to filter data more specifically\n` +
    `- Select only necessary columns instead of using SELECT *\n` +
    `- Add indexes on columns used in WHERE and JOIN clauses\n` +
    `- Use EXPLAIN to analyze query performance\n` +
    `- Consider breaking complex queries into smaller operations\n` +
    `- Increase MYSQL_QUERY_TIMEOUT environment variable if necessary\n`
  );
}

/**
 * Handle Zod validation errors
 */
export function handleValidationError(error: ZodError): string {
  const issues = error.issues
    .map(issue => {
      const path = issue.path.join('.');
      return `- **${path}**: ${issue.message}`;
    })
    .join('\n');

  return `**Input validation error**\n\n` + `The following validation errors occurred:\n\n` + `${issues}\n`;
}

/**
 * Handle unknown errors
 */
export function handleUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `**Error: ${error.name}**\n\n${error.message}\n`;
  }

  return `**Unexpected error**\n\n${String(error)}\n`;
}

/**
 * Main error handler that routes to specific handlers
 */
export function handleQueryError(error: unknown, queryTimeout: number): string {
  // Check for timeout first
  if (isTimeoutError(error)) {
    return handleTimeoutError(queryTimeout);
  }

  // Check for Zod validation errors
  if (error instanceof ZodError) {
    return handleValidationError(error);
  }

  // Check for MySQL errors
  if (isMySQLError(error)) {
    return handleMySQLError(error);
  }

  // Handle as generic error
  return handleUnknownError(error);
}
