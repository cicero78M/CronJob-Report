import pkg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pkg;

const pool = new Pool({
  user: env.DB_USER,
  host: env.DB_HOST,
  database: env.DB_NAME,
  password: env.DB_PASS,
  port: env.DB_PORT,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  query_timeout: env.DB_QUERY_TIMEOUT_MS,
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: env.DB_STATEMENT_TIMEOUT_MS
});

const decorateTimeoutError = (error, text) => {
  if (!error) {
    return error;
  }

  const isTimeoutError =
    error.code === '57014' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ECONNRESET' ||
    (typeof error.message === 'string' &&
      (error.message.toLowerCase().includes('timeout') ||
        error.message.toLowerCase().includes('timed out')));

  if (!isTimeoutError) {
    return error;
  }

  error.isDbTimeout = true;
  error.dbQuery = text;
  return error;
};

export const query = async (text, params) => {
  try {
    return await pool.query(text, params);
  } catch (error) {
    throw decorateTimeoutError(error, text);
  }
};

export const getClient = async () => {
  try {
    return await pool.connect();
  } catch (error) {
    throw decorateTimeoutError(error);
  }
};

export const close = () => pool.end();
