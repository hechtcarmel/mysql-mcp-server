/**
 * MySQL client with connection pool management
 */

import mysql from 'mysql2/promise';
import type { Pool, PoolOptions, QueryOptions } from 'mysql2/promise';
import { ServerConfig, MySQLQueryResult } from '../types.js';
import { logInfo, logError } from '../utils/logger.js';

/**
 * MySQL client class that manages connection pool and query execution
 */
export class MySQLClient {
  private pool: Pool | null = null;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * Initialize the connection pool
   */
  async initialize(): Promise<void> {
    const poolConfig: PoolOptions = {
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      connectionLimit: this.config.poolSize,
      connectTimeout: this.config.connectionTimeout,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    };

    // Add SSL configuration if provided
    if (this.config.ssl) {
      poolConfig.ssl = {
        ca: this.config.ssl.ca,
        cert: this.config.ssl.cert,
        key: this.config.ssl.key,
        rejectUnauthorized: this.config.ssl.rejectUnauthorized
      };
    }

    try {
      this.pool = mysql.createPool(poolConfig);
      logInfo('MySQL connection pool created successfully');
    } catch (error) {
      logError('Failed to create MySQL connection pool', error);
      throw new Error(`Failed to initialize MySQL client: ${error}`);
    }
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    if (!this.pool) {
      throw new Error('MySQL client not initialized. Call initialize() first.');
    }

    try {
      await this.pool.query('SELECT 1');
      logInfo('✓ Database connection test successful');
      return true;
    } catch (error) {
      logError('✗ Database connection test failed', error);
      return false;
    }
  }

  /**
   * Execute a SQL query with timeout
   */
  async executeQuery(sql: string, timeout?: number): Promise<MySQLQueryResult> {
    if (!this.pool) {
      throw new Error('MySQL client not initialized. Call initialize() first.');
    }

    const queryTimeout = timeout || this.config.queryTimeout;

    try {
      const queryOptions: QueryOptions = {
        sql,
        timeout: queryTimeout
      };

      const result = await this.pool.query(queryOptions);
      return result as MySQLQueryResult;
    } catch (error) {
      // Re-throw with more context
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error(`Query execution timeout exceeded (${queryTimeout}ms)`);
        }
      }
      throw error;
    }
  }

  /**
   * Get a connection from the pool for manual transaction management
   */
  async getConnection(): Promise<mysql.PoolConnection> {
    if (!this.pool) {
      throw new Error('MySQL client not initialized. Call initialize() first.');
    }

    return await this.pool.getConnection();
  }

  /**
   * Close the connection pool gracefully
   */
  async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.end();
        logInfo('MySQL connection pool closed successfully');
        this.pool = null;
      } catch (error) {
        logError('Error closing MySQL connection pool', error);
        throw error;
      }
    }
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): { totalConnections: number; activeConnections: number; idleConnections: number } | null {
    if (!this.pool) {
      return null;
    }

    // Note: mysql2 doesn't expose detailed pool stats directly
    // This is a placeholder for future enhancement
    return {
      totalConnections: this.config.poolSize,
      activeConnections: 0, // Not available in mysql2
      idleConnections: 0 // Not available in mysql2
    };
  }
}
