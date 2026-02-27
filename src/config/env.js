import dotenv from 'dotenv';

dotenv.config();

const readRaw = key => process.env[key];

const parseStr = (key, { defaultValue, required = false } = {}) => {
  const raw = readRaw(key);

  if (raw === undefined || raw === null || raw === '') {
    if (required && defaultValue === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }

    return defaultValue ?? '';
  }

  return raw;
};

const parseNum = (key, { defaultValue, required = false } = {}) => {
  const raw = readRaw(key);

  if (raw === undefined || raw === null || raw === '') {
    if (required && defaultValue === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }

    return defaultValue;
  }

  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid numeric environment variable: ${key}`);
  }

  return value;
};

const parsePort = (key, { defaultValue, required = false } = {}) => {
  const value = parseNum(key, { defaultValue, required });

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid port environment variable: ${key}`);
  }

  return value;
};

const parseBool = (key, { defaultValue = false } = {}) => {
  const raw = readRaw(key);

  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }

  const normalized = raw.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean environment variable: ${key}`);
};

export const env = Object.freeze({
  PORT: parsePort('PORT', { defaultValue: 3000 }),
  DB_USER: parseStr('DB_USER', { defaultValue: '' }),
  DB_HOST: parseStr('DB_HOST', { defaultValue: '' }),
  DB_NAME: parseStr('DB_NAME', { defaultValue: '' }),
  DB_PASS: parseStr('DB_PASS', { defaultValue: '' }),
  DB_PORT: parsePort('DB_PORT', { defaultValue: 5432 }),
  DB_CONNECTION_TIMEOUT_MS: parseNum('DB_CONNECTION_TIMEOUT_MS', {
    defaultValue: 10000
  }),
  DB_QUERY_TIMEOUT_MS: parseNum('DB_QUERY_TIMEOUT_MS', { defaultValue: 30000 }),
  DB_STATEMENT_TIMEOUT_MS: parseNum('DB_STATEMENT_TIMEOUT_MS', {
    defaultValue: 30000
  }),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: parseNum('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', {
    defaultValue: 30000
  }),
  DB_DRIVER: parseStr('DB_DRIVER', { defaultValue: 'postgres' }),
  REDIS_URL: parseStr('REDIS_URL', { defaultValue: 'redis://localhost:6379' }),
  CORS_ORIGIN: parseStr('CORS_ORIGIN', { defaultValue: '*' }),
  ALLOW_DUPLICATE_REQUESTS: parseBool('ALLOW_DUPLICATE_REQUESTS', {
    defaultValue: false
  }),
  SECRET_KEY: parseStr('SECRET_KEY', { defaultValue: '' }),
  JWT_SECRET: parseStr('JWT_SECRET', { required: true }),
  RAPIDAPI_KEY: parseStr('RAPIDAPI_KEY', { defaultValue: '' }),
  RAPIDAPI_FALLBACK_KEY: parseStr('RAPIDAPI_FALLBACK_KEY', { defaultValue: '' }),
  RAPIDAPI_FALLBACK_HOST: parseStr('RAPIDAPI_FALLBACK_HOST', { defaultValue: '' }),
  ADMIN_WHATSAPP: parseStr('ADMIN_WHATSAPP', { defaultValue: '' }),
  GATEWAY_WHATSAPP_ADMIN: parseStr('GATEWAY_WHATSAPP_ADMIN', {
    defaultValue: ''
  }),
  DIRECTORATE_WA_SESSION_NAME: parseStr('DIRECTORATE_WA_SESSION_NAME', {
    defaultValue: ''
  }),
  OPERATOR_WA_SESSION_NAME: parseStr('OPERATOR_WA_SESSION_NAME', {
    defaultValue: ''
  }),
  APP_SESSION_NAME: parseStr('APP_SESSION_NAME', { defaultValue: '' }),
  GATEWAY_WA_CLIENT_ID: parseStr('GATEWAY_WA_CLIENT_ID', {
    defaultValue: 'wa-gateway'
  }),
  WA_AUTH_DATA_PATH: parseStr('WA_AUTH_DATA_PATH', { defaultValue: '' }),
  WA_WEB_VERSION: parseStr('WA_WEB_VERSION', { defaultValue: '' }),
  WA_WEB_VERSION_CACHE_URL: parseStr('WA_WEB_VERSION_CACHE_URL', {
    defaultValue:
      'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json'
  }),
  WA_WWEBJS_PROTOCOL_TIMEOUT_MS: parseNum('WA_WWEBJS_PROTOCOL_TIMEOUT_MS', {
    defaultValue: 120000
  }),
  WA_INIT_MAX_RETRIES: parseNum('WA_INIT_MAX_RETRIES', { defaultValue: 3 }),
  WA_INIT_RETRY_DELAY_MS: parseNum('WA_INIT_RETRY_DELAY_MS', {
    defaultValue: 10000
  }),
  WA_QR_TIMEOUT_MS: parseNum('WA_QR_TIMEOUT_MS', { defaultValue: 120000 }),
  WA_ENABLE_BAD_SESSION_RECOVERY: parseBool('WA_ENABLE_BAD_SESSION_RECOVERY', {
    defaultValue: true
  }),
  ENABLE_DIRREQUEST_GROUP: parseBool('ENABLE_DIRREQUEST_GROUP', {
    defaultValue: true
  }),
  DEBUG_FETCH_INSTAGRAM: parseBool('DEBUG_FETCH_INSTAGRAM', {
    defaultValue: false
  }),
  AMQP_URL: parseStr('AMQP_URL', { defaultValue: 'amqp://localhost' }),
  BACKUP_DIR: parseStr('BACKUP_DIR', { defaultValue: 'backups' }),
  GOOGLE_DRIVE_FOLDER_ID: parseStr('GOOGLE_DRIVE_FOLDER_ID', { defaultValue: '' }),
  GOOGLE_SERVICE_ACCOUNT: parseStr('GOOGLE_SERVICE_ACCOUNT', {
    defaultValue: ''
  }),
  GOOGLE_IMPERSONATE_EMAIL: parseStr('GOOGLE_IMPERSONATE_EMAIL', {
    defaultValue: ''
  }),
  GOOGLE_CONTACT_SCOPE: parseStr('GOOGLE_CONTACT_SCOPE', {
    defaultValue: 'https://www.googleapis.com/auth/contacts'
  }),
  DASHBOARD_PREMIUM_ALLOWED_TIERS: parseStr('DASHBOARD_PREMIUM_ALLOWED_TIERS', {
    defaultValue: 'tier1,tier2,premium_1'
  })
});
