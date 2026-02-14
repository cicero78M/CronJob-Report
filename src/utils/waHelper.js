// src/utils/waHelper.js
import dotenv from 'dotenv';
import mime from 'mime-types';
import path from 'path';
dotenv.config();

const spreadsheetMimeTypes = {
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const defaultMimeType = spreadsheetMimeTypes['.xlsx'];

const validWaSuffixes = ['@c.us', '@s.whatsapp.net', '@g.us'];
export const userWaSuffixes = ['@c.us', '@s.whatsapp.net'];
export const minPhoneDigitLength = 8;
const GROUP_ID_PATTERN = /^(\d{10,22})(?:@g\.us)?$/i;

export function isValidWid(wid) {
  return (
    typeof wid === 'string' &&
    validWaSuffixes.some(suffix => wid.endsWith(suffix))
  );
}

export function extractPhoneDigits(value) {
  return String(value ?? '')
    .replace(/\D/g, '');
}

export function isValidPhoneDigits(token, minLength = minPhoneDigitLength) {
  return extractPhoneDigits(token).length >= minLength;
}

export function normalizeGroupId(groupId) {
  if (!groupId) return null;

  const trimmed = String(groupId).trim();
  if (!trimmed) return null;

  const invitePrefix = /^(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?/i;
  const withoutPrefix = invitePrefix.test(trimmed)
    ? trimmed.replace(invitePrefix, '').split(/[?#]/)[0]
    : trimmed;

  const token = withoutPrefix.replace(/\/+$/, '');
  const match = token.match(GROUP_ID_PATTERN);
  const candidate = match ? `${match[1]}@g.us` : token;

  return /^\d{10,22}@g\.us$/.test(candidate) ? candidate.toLowerCase() : null;
}

export function getAdminWhatsAppList() {
  return (process.env.ADMIN_WHATSAPP || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(wid => (wid.endsWith('@c.us') ? wid : wid.replace(/\D/g, '') + '@c.us'))
    .filter(wid => wid.length > 10);
}

export async function sendWAReport(waClient, message, chatIds = null) {
  const targets = chatIds
    ? (Array.isArray(chatIds) ? chatIds : [chatIds])
    : getAdminWhatsAppList();
  for (const target of targets) {
    if (!isValidWid(target)) {
      console.warn(`[SKIP WA] Invalid wid: ${target}`);
      continue;
    }
    try {
      await waClient.sendMessage(target, message);
      console.log(
        `[WA CRON] Sent WA to ${target}: ${message.substring(0, 64)}...`
      );
    } catch (err) {
      console.error(`[WA CRON] ERROR send WA to ${target}:`, err.message);
    }
  }
}

export async function sendWAFile(
  waClient,
  buffer,
  filename,
  chatIds = null,
  mimeType
) {
  const targets = chatIds
    ? Array.isArray(chatIds)
      ? chatIds
      : [chatIds]
    : getAdminWhatsAppList();
  if (typeof waClient?.waitForWaReady === 'function') {
    await waClient.waitForWaReady();
  } else if (
    typeof waClient?.isReady === 'function' ||
    typeof waClient?.getState === 'function' ||
    typeof waClient?.once === 'function'
  ) {
    const ready = await waitUntilReady(waClient);
    if (!ready) {
      console.warn(`[WA] Client not ready, cannot send file: ${filename}`);
      return;
    }
  }
  const ext = path.extname(filename).toLowerCase();
  const resolvedMimeType =
    mimeType || spreadsheetMimeTypes[ext] || mime.lookup(filename) || defaultMimeType;
  for (const target of targets) {
    if (!isValidWid(target)) {
      console.warn(`[SKIP WA] Invalid wid: ${target}`);
      continue;
    }
    try {
      let chatId = target;
      if (typeof waClient.onWhatsApp === 'function' && !target.endsWith('@g.us')) {
        const [result] = await waClient.onWhatsApp(target);
        if (!result?.exists) {
          console.warn(`[SKIP WA] Unregistered wid: ${target}`);
          continue;
        }
        chatId = result.jid || chatId;
      }
      await waClient.sendMessage(chatId, {
        document: buffer,
        mimetype: resolvedMimeType,
        fileName: filename,
      });
      console.log(`[WA CRON] Sent file to ${target}: ${filename}`);
    } catch (err) {
      console.error(`[WA CRON] ERROR send file to ${target}:`, err.message);
    }
  }
}

// Cek apakah nomor WhatsApp adalah admin
export function isAdminWhatsApp(number) {
  const adminNumbers = (process.env.ADMIN_WHATSAPP || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => (n.endsWith("@c.us") ? n : n.replace(/\D/g, "") + "@c.us"));
  const normalized =
    typeof number === "string"
      ? number.endsWith("@c.us")
        ? number
        : number.replace(/\D/g, "") + "@c.us"
      : "";
  return adminNumbers.includes(normalized);
}

// Konversi nomor ke WhatsAppID (xxxx@c.us)
export function formatToWhatsAppId(nohp) {
  const number = extractPhoneDigits(nohp);
  if (!number) return '';
  const normalized = number.startsWith('62')
    ? number
    : '62' + number.replace(/^0/, '');
  return `${normalized}@c.us`;
}

function normalizeChatId(chatId) {
  const normalized = typeof chatId === 'string' ? chatId.trim() : '';
  if (!normalized) return '';
  if (isValidWid(normalized)) {
    if (normalized.endsWith('@g.us')) return normalized;
    const digits = extractPhoneDigits(normalized);
    if (!isValidPhoneDigits(digits, minPhoneDigitLength)) return normalized;
    return formatToWhatsAppId(digits);
  }
  const digits = extractPhoneDigits(normalized);
  if (!digits) return normalized;
  if (!isValidPhoneDigits(digits, minPhoneDigitLength)) return normalized;
  return formatToWhatsAppId(digits);
}

function isMissingLidError(err) {
  const message = String(err?.message || '').toLowerCase();
  return message.includes('lid is missing in chat table');
}

async function hydrateChat(waClient, chatId) {
  if (!chatId) return null;
  let chat = null;

  if (typeof waClient?.getChat === 'function') {
    try {
      chat = await waClient.getChat(chatId);
    } catch (err) {
      console.warn('[WA] getChat failed:', err?.message || err);
    }
  }

  if (!chat && typeof waClient?.getContact === 'function') {
    try {
      const contact = await waClient.getContact(chatId);
      if (contact?.id?._serialized && typeof waClient?.getChat === 'function') {
        chat = await waClient.getChat(contact.id._serialized);
      }
    } catch (err) {
      console.warn('[WA] getContact failed:', err?.message || err);
    }
  }

  return chat;
}

async function resolveChatId(waClient, chatId) {
  const normalized = normalizeChatId(chatId);
  if (!normalized) return '';
  const isGroup = normalized.endsWith('@g.us');
  const digits = extractPhoneDigits(normalized);
  const canFallback = !isGroup && isValidPhoneDigits(digits, minPhoneDigitLength);

  if (!isGroup && isValidPhoneDigits(digits, minPhoneDigitLength) && typeof waClient?.getNumberId === 'function') {
    try {
      const numberId = await waClient.getNumberId(digits);
      if (numberId?._serialized) {
        const chat = await hydrateChat(waClient, numberId._serialized);
        return chat?.id?._serialized || numberId._serialized;
      }
      if (numberId == null) {
        if (canFallback) {
          const fallbackId = formatToWhatsAppId(digits);
          console.warn(
            '[WA] getNumberId returned null, using fallback @c.us:',
            fallbackId
          );
          const chat = await hydrateChat(waClient, fallbackId);
          return chat?.id?._serialized || fallbackId;
        }
        return '';
      }
    } catch (err) {
      console.warn('[WA] getNumberId failed:', err?.message || err);
      if (canFallback) {
        const fallbackId = formatToWhatsAppId(digits);
        console.warn('[WA] getNumberId failed, using fallback @c.us:', fallbackId);
        const chat = await hydrateChat(waClient, fallbackId);
        return chat?.id?._serialized || fallbackId;
      }
    }
  }

  if (typeof waClient?.getContact === 'function') {
    try {
      const contact = await waClient.getContact(normalized);
      if (contact?.id?._serialized) {
        const chat = await hydrateChat(waClient, contact.id._serialized);
        return chat?.id?._serialized || contact.id._serialized;
      }
    } catch (err) {
      console.warn('[WA] getContact failed:', err?.message || err);
    }
  }

  if (!isGroup && typeof waClient?.getChat === 'function') {
    try {
      const chat = await waClient.getChat(normalized);
      if (chat?.id?._serialized) {
        return chat.id._serialized;
      }
    } catch (err) {
      console.warn('[WA] getChat failed:', err?.message || err);
    }
  }

  return normalized;
}

// Normalisasi nomor WhatsApp ke awalan 62 tanpa suffix @c.us
export function normalizeWhatsappNumber(nohp) {
  let number = extractPhoneDigits(nohp);
  if (!number) return '';
  if (!number.startsWith("62")) number = "62" + number.replace(/^0/, "");
  return number;
}

export function normalizeUserWhatsAppId(contact, minLength = minPhoneDigitLength) {
  if (!contact) return null;

  const trimmed = String(contact).trim();
  if (!trimmed) return null;

  const hasUserSuffix = userWaSuffixes.some((suffix) => trimmed.endsWith(suffix));
  if (hasUserSuffix) {
    return isValidPhoneDigits(trimmed, minLength) ? trimmed : null;
  }

  const digits = extractPhoneDigits(trimmed);
  if (!isValidPhoneDigits(digits, minLength)) return null;

  return formatToWhatsAppId(digits);
}

// Format output data client (untuk WA)
export function formatClientData(obj, title = "") {
  let keysOrder = [
    "client_id",
    "nama",
    "client_type",
    "client_status",
    "client_insta",
    "client_insta_status",
    "client_tiktok",
    "client_tiktok_status",
    "client_amplify_status",
    "client_operator",
    "client_super",
    "client_group",
    "tiktok_secuid",
  ];
  let dataText = title ? `${title}\n` : "";
  for (const key of keysOrder) {
    if (key in obj) {
      let v = obj[key];
      if (typeof v === "object" && v !== null) v = JSON.stringify(v);
      dataText += `*${key}*: ${v}\n`;
    }
  }
  Object.keys(obj).forEach((key) => {
    if (!keysOrder.includes(key)) {
      let v = obj[key];
      if (typeof v === "object" && v !== null) v = JSON.stringify(v);
      dataText += `*${key}*: ${v}\n`;
    }
  });
  return dataText;
}

const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || "")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

export function getAdminWAIds() {
  return ADMIN_WHATSAPP.map((n) =>
    n.endsWith("@c.us") ? n : n.replace(/[^0-9]/g, "") + "@c.us"
  );
}

// Normalisasi nomor admin ke awalan 0 (tanpa @c.us)
export function getAdminWANumbers() {
  const numbers = ADMIN_WHATSAPP.map((n) => {
    let num = String(n).replace(/[^0-9]/g, "");
    if (num.startsWith("62")) num = "0" + num.slice(2);
    if (!num.startsWith("0")) num = "0" + num;
    return num;
  });
  return Array.from(new Set(numbers));
}

// Send WhatsApp message with basic error handling
async function waitUntilReady(waClient, timeout = 10000) {
  if (!waClient) return false;

  try {
    if (typeof waClient.isReady === 'function') {
      const ok = await waClient.isReady();
      if (ok) return true;
    } else if (typeof waClient.getState === 'function') {
      const state = await waClient.getState();
      if (state === 'CONNECTED' || state === 'open') return true;
    }
  } catch {
    // ignore and fall back to event listener
  }

  if (typeof waClient.once !== 'function') return false;
  return new Promise((resolve) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      waClient.off?.('ready', onReady);
      resolve(false);
    }, timeout);
    waClient.once('ready', onReady);
  });
}

async function isClientReadyForReport(waClient) {
  if (!waClient) return false;

  if (typeof waClient.waitForWaReady === 'function') {
    try {
      await waClient.waitForWaReady();
      return true;
    } catch {
      return false;
    }
  }

  if (typeof waClient.isReady === 'function') {
    try {
      return (await waClient.isReady()) === true;
    } catch {
      return false;
    }
  }

  return false;
}

function computeDelay(attemptIndex, baseDelayMs, maxDelayMs, jitterRatio) {
  const baseDelay = Math.max(0, Number(baseDelayMs) || 0);
  const maxDelay = Math.max(baseDelay, Number(maxDelayMs) || baseDelay);
  if (baseDelay === 0) return 0;
  const exponentialDelay = Math.min(maxDelay, baseDelay * 2 ** attemptIndex);
  const jitterFraction = Math.max(0, Math.min(1, Number(jitterRatio) || 0));
  const jitterOffset =
    jitterFraction > 0 ? Math.random() * exponentialDelay * jitterFraction : 0;
  return Math.min(maxDelay, Math.floor(exponentialDelay + jitterOffset));
}

function defaultShouldRetry(err) {
  if (!err) return false;
  if (err.retryable === false || err.retriable === false) return false;
  if (err.isFatal || err.fatal || err.nonRetryable) return false;

  const status =
    err.status ?? err.statusCode ?? err.httpStatus ?? err?.response?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return false;
  }

  const code = err.code || err?.response?.data?.code;
  const name = err.name || err?.response?.data?.name;
  if (
    code === 'ERR_INVALID_ARG_TYPE' ||
    code === 'ERR_INVALID_ARG_VALUE' ||
    code === 'ValidationError' ||
    name === 'ValidationError'
  ) {
    return false;
  }

  const message = String(err.message || '').toLowerCase();
  if (!message) return true;
  if (
    message.includes('invalid parameter') ||
    message.includes('parameter invalid') ||
    message.includes('invalid recipient') ||
    message.includes('not a valid') ||
    message.includes('bad request') ||
    message.includes('lid is missing in chat table') ||
    message.includes('sendmessage returned no id')
  ) {
    return false;
  }

  return true;
}

async function sendWithRetry(task, config = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 5000,
    jitterRatio = 0.2,
    shouldRetry,
  } = config;
  const evaluateRetry = typeof shouldRetry === 'function' ? shouldRetry : defaultShouldRetry;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await task(attempt + 1);
    } catch (err) {
      const canRetry = attempt + 1 < maxAttempts && evaluateRetry(err, attempt + 1);
      if (!canRetry) {
        throw err;
      }

      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        await Promise.resolve();
      }
    }
  }
  throw new Error('sendWithRetry exhausted attempts');
}

export async function safeSendMessage(waClient, chatId, message, options = {}) {
  let retryOptions = {};
  let sendOptions = options ?? {};
  let onErrorHandler = null;

  if (options && typeof options === 'object' && !Array.isArray(options)) {
    const { retry, onError, ...rest } = options;
    if (Object.prototype.hasOwnProperty.call(options, 'retry')) {
      retryOptions = retry ?? {};
    }
    sendOptions = rest;
    onErrorHandler = typeof onError === 'function' ? onError : null;
  }

  if (sendOptions == null || typeof sendOptions !== 'object') {
    sendOptions = {};
  }

  const retryConfig = {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    jitterRatio: 0.2,
    shouldRetry: (err, attempt) => {
      if (isMissingLidError(err) && attempt < 2) {
        return true;
      }
      return defaultShouldRetry(err, attempt);
    },
    ...retryOptions,
  };

  const ensureClientReady = async () => {
    if (typeof waClient?.waitForWaReady === 'function') {
      await waClient.waitForWaReady();
      return;
    }
    const ready = await waitUntilReady(waClient);
    if (!ready) {
      const error = new Error('WhatsApp client not ready');
      error.retryable = true;
      throw error;
    }
  };

  let resolvedChatId = null;

  try {
    await sendWithRetry(async () => {
      await ensureClientReady();
      resolvedChatId = await resolveChatId(waClient, chatId);
      if (!resolvedChatId) {
        const error = new Error('chatId penerima tidak valid');
        error.retryable = false;
        throw error;
      }
      await hydrateChat(waClient, resolvedChatId);
      try {
        await waClient.sendMessage(resolvedChatId, message, sendOptions);
      } catch (err) {
        if (isMissingLidError(err)) {
          await hydrateChat(waClient, resolvedChatId);
        }
        throw err;
      }
    }, retryConfig);

    console.log(
      `[WA] Sent message to ${resolvedChatId || chatId}: ${String(message).substring(0, 64)}`
    );
    return true;
  } catch (err) {
    const contentTypeInfo = err?.contentType
      ? ` (contentType=${err.contentType})`
      : '';
    if (onErrorHandler) {
      onErrorHandler(err);
    }
    console.error(
      `[WA] Failed to send message to ${resolvedChatId || chatId}${contentTypeInfo}: ${err?.message || err}`
    );
    return false;
  }
}

function summarizeSendError(err) {
  if (!err) return 'unknown error';
  const message = String(err?.message || err);
  const code = err?.code || err?.status || err?.statusCode || err?.data?.code;
  const name = err?.name;
  const details = [name ? `name=${name}` : null, code ? `code=${code}` : null]
    .filter(Boolean)
    .join(' ');
  if (details) {
    return `${message} (${details})`.trim();
  }
  return message.trim();
}

function stringifyContext(context) {
  if (!context) return '';
  try {
    const serialized = JSON.stringify(context);
    return serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized;
  } catch {
    return String(context);
  }
}

const blockedClientChatMap = new Map();
const blockedClientChatWarned = new Set();

// Store blocked groups with timestamps for expiry management
// Structure: Map<chatId, { blockedAt: timestamp, reason: string }>
const blockedGroupChats = new Map();

// Configuration for blocked group expiry
const BLOCKED_GROUP_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const BLOCKED_GROUP_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Clean up every hour

/**
 * Clean up expired blocked groups
 * Groups that have been blocked for more than BLOCKED_GROUP_EXPIRY_MS will be unblocked
 * This allows retry attempts after the bot might have been re-added to the group
 */
function cleanupExpiredBlockedGroups() {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [chatId, blockInfo] of blockedGroupChats.entries()) {
    const age = now - blockInfo.blockedAt;
    if (age >= BLOCKED_GROUP_EXPIRY_MS) {
      blockedGroupChats.delete(chatId);
      cleanedCount++;
      console.log(`[WA] Unblocked group ${chatId} after ${Math.floor(age / 1000 / 60)} minutes (block expired)`);
    }
  }

  if (cleanedCount > 0) {
    console.log(`[WA] Cleaned up ${cleanedCount} expired blocked group(s)`);
  }
}

/**
 * Check if a group is currently blocked
 * Returns true if the group is blocked and not expired
 */
function isGroupBlocked(chatId) {
  if (!blockedGroupChats.has(chatId)) {
    return false;
  }

  const blockInfo = blockedGroupChats.get(chatId);
  const age = Date.now() - blockInfo.blockedAt;

  if (age >= BLOCKED_GROUP_EXPIRY_MS) {
    // Block has expired, remove it
    blockedGroupChats.delete(chatId);
    console.log(`[WA] Unblocked group ${chatId} (block expired)`);
    return false;
  }

  return true;
}

/**
 * Block a group with timestamp and reason
 */
function blockGroup(chatId, reason) {
  blockedGroupChats.set(chatId, {
    blockedAt: Date.now(),
    reason: reason || 'Bot lacks permission or was removed from group'
  });
  console.warn(`[WA] Globally blocking group ${chatId} due to: ${reason || 'permanent access error'}`);
}

// Start periodic cleanup of expired blocked groups
let cleanupIntervalId = null;
if (typeof setInterval !== 'undefined') {
  cleanupIntervalId = setInterval(cleanupExpiredBlockedGroups, BLOCKED_GROUP_CLEANUP_INTERVAL_MS);
  // Allow Node.js to exit even if this timer is active
  if (cleanupIntervalId.unref) {
    cleanupIntervalId.unref();
  }
}

function toNumericCode(value) {
  if (value === 403) return 403;
  if (typeof value === 'string' && value.trim() === '403') return 403;
  return null;
}

function isPermanentGroupSendError(err) {
  if (!err) return false;

  const candidates = [
    err?.statusCode,
    err?.status,
    err?.code,
    err?.data,
    err?.response?.status,
    err?.response?.data?.statusCode,
    err?.response?.data?.code,
    err?.response?.data,
  ];

  if (candidates.some((candidate) => toNumericCode(candidate) === 403)) {
    return true;
  }

  const message = String(err?.message || '').toLowerCase();
  return (
    message.includes('lacks permission') ||
    message.includes('removed from group')
  );
}

export async function sendWithClientFallback({
  chatId,
  message,
  clients = [],
  sendOptions = {},
  reportClient = null,
  reportContext = null,
} = {}) {
  const attempts = Array.isArray(clients)
    ? clients.filter((entry) => entry?.client)
    : [];
  const labels = attempts.map((entry) => entry?.label || 'unknown');
  const contextText = stringifyContext(reportContext);
  if (!chatId || !attempts.length) {
    console.warn(
      `[WA] Fallback send aborted: chatId=${chatId || 'unknown'} clients=${labels.join(',')}`
    );
    return false;
  }

  // Determine if this is a group chat (used throughout the function)
  const isGroupChat = chatId && String(chatId).endsWith('@g.us');

  // Check if this group chat is globally blocked due to permanent errors
  // The check automatically handles expiry - if block has expired, it will return false
  if (isGroupChat && isGroupBlocked(chatId)) {
    const blockInfo = blockedGroupChats.get(chatId);
    const age = Math.floor((Date.now() - blockInfo.blockedAt) / 1000 / 60);
    const contextSuffix = contextText ? `; context=${contextText}` : '';
    console.warn(`[WA] Skip blocked group ${chatId} (blocked ${age} min ago: ${blockInfo.reason})${contextSuffix}`);
    return false;
  }

  let previousError = null;

  for (const { client, label } of attempts) {
    const blockKey = `${label}:${chatId}`;
    if (blockedClientChatMap.get(blockKey) === true) {
      if (!blockedClientChatWarned.has(blockKey)) {
        console.warn(`[WA] Skip blocked route ${label} -> ${chatId}`);
        blockedClientChatWarned.add(blockKey);
      }
      previousError = previousError || `blocked route ${label}:${chatId}`;
      continue;
    }

    if (previousError) {
      const contextSuffix = contextText ? `; context=${contextText}` : '';
      console.warn(
        `[WA] Fallback attempt via ${label} for ${chatId}; previousError=${previousError}${contextSuffix}`
      );
    }

    let attemptError = null;
    const sent = await safeSendMessage(client, chatId, message, {
      ...sendOptions,
      retry: {
        shouldRetry: (err, attempt) => {
          if (isPermanentGroupSendError(err)) return false;
          return attempt < 2 && isMissingLidError(err)
            ? true
            : defaultShouldRetry(err, attempt);
        },
      },
      onError: (err) => {
        attemptError = err;
      },
    });

    if (sent) {
      return true;
    }

    const summary = summarizeSendError(attemptError);
    if (isPermanentGroupSendError(attemptError)) {
      blockedClientChatMap.set(blockKey, true);
      blockedClientChatWarned.delete(blockKey);
      
      // If this is a group chat with a permanent error (403), block it globally
      // to prevent other clients from attempting to send to the same group
      // The block will automatically expire after BLOCKED_GROUP_EXPIRY_MS
      if (isGroupChat) {
        blockGroup(chatId, summary);
        // Stop trying other clients immediately for this group
        const contextSuffix = contextText ? `; context=${contextText}` : '';
        console.warn(`[WA] All clients will fail for ${chatId}: Bot removed or lacks permission${contextSuffix}`);
        previousError = summary;
        break;
      }
    }
    const contextSuffix = contextText ? `; context=${contextText}` : '';
    console.warn(`[WA] Send failed via ${label} for ${chatId}: ${summary}${contextSuffix}`);
    previousError = summary;
  }

  const reportMessage =
    `[WA] Semua fallback client gagal mengirim pesan ke ${chatId}. ` +
    `clients=${labels.join(', ') || 'unknown'}; lastError=${previousError || 'unknown'}` +
    (contextText ? `; context=${contextText}` : '');

  let selectedReportClient = null;

  if (await isClientReadyForReport(reportClient)) {
    selectedReportClient = reportClient;
  } else {
    for (const { client } of attempts) {
      if (await isClientReadyForReport(client)) {
        selectedReportClient = client;
        break;
      }
    }
  }

  if (selectedReportClient) {
    await sendWAReport(selectedReportClient, reportMessage);
  } else {
    console.warn('[WA] Report WA dilewati: semua client not ready');
  }

  console.error('[WA] Fallback send failed', {
    chatId,
    clients: labels,
    lastError: previousError,
    context: reportContext,
  });
  return false;
}

export function isUnsupportedVersionError(err) {
  const msg = (err?.message || '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('update whatsapp') ||
    msg.includes('upgrade whatsapp') ||
    (msg.includes('update') && msg.includes('whatsapp')) ||
    msg.includes('unsupported version') ||
    msg.includes('versi whatsapp anda terlalu lama')
  );
}

/**
 * Get list of currently blocked groups (for monitoring/debugging)
 * Returns array of { chatId, blockedAt, reason, age }
 */
export function getBlockedGroups() {
  const now = Date.now();
  const result = [];
  
  for (const [chatId, blockInfo] of blockedGroupChats.entries()) {
    result.push({
      chatId,
      blockedAt: blockInfo.blockedAt,
      reason: blockInfo.reason,
      ageMinutes: Math.floor((now - blockInfo.blockedAt) / 1000 / 60)
    });
  }
  
  return result;
}

/**
 * Manually unblock a group (for admin/debugging purposes)
 * Returns true if group was unblocked, false if it wasn't blocked
 */
export function unblockGroup(chatId) {
  if (blockedGroupChats.has(chatId)) {
    blockedGroupChats.delete(chatId);
    
    // Also clear client-specific blocks for this chat
    for (const [key] of blockedClientChatMap.entries()) {
      if (key.endsWith(`:${chatId}`)) {
        blockedClientChatMap.delete(key);
      }
    }
    
    console.log(`[WA] Manually unblocked group ${chatId}`);
    return true;
  }
  return false;
}

/**
 * Clear all blocked groups (for admin/debugging purposes)
 */
export function clearAllBlockedGroups() {
  const count = blockedGroupChats.size;
  blockedGroupChats.clear();
  console.log(`[WA] Cleared all ${count} blocked group(s)`);
  return count;
}
