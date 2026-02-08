/**
 * WAHelpers - Utility functions for WhatsApp operations
 * 
 * Provides helper functions for formatting, validation, and common operations
 * Updated to support both wwebjs (@c.us) and Baileys (@s.whatsapp.net) formats
 */

import { env } from '../config/env.js';

/**
 * Format phone number to WhatsApp ID
 * Returns Baileys format (@s.whatsapp.net) by default for consistency
 */
export function formatToWhatsAppId(phoneNumber) {
  if (!phoneNumber) {
    return null;
  }

  // Remove all non-numeric characters
  let cleanNumber = phoneNumber.toString().replace(/\D/g, '');

  // If already has WhatsApp suffix, normalize to Baileys format
  if (phoneNumber.includes('@c.us')) {
    cleanNumber = phoneNumber.replace('@c.us', '').replace(/\D/g, '');
  } else if (phoneNumber.includes('@s.whatsapp.net')) {
    return phoneNumber; // Already in Baileys format
  } else if (phoneNumber.includes('@g.us')) {
    return phoneNumber; // Group ID, keep as-is
  }

  // Convert 0 prefix to 62 (Indonesia)
  if (cleanNumber.startsWith('0')) {
    cleanNumber = '62' + cleanNumber.substring(1);
  }

  // Ensure 62 prefix
  if (!cleanNumber.startsWith('62')) {
    cleanNumber = '62' + cleanNumber;
  }

  // Return in Baileys format for consistency
  return `${cleanNumber}@s.whatsapp.net`;
}

/**
 * Check if WhatsApp ID is valid
 * Supports both wwebjs and Baileys formats
 */
export function isValidWid(wid) {
  if (!wid) {
    return false;
  }

  const validSuffixes = ['@c.us', '@s.whatsapp.net', '@g.us'];
  return validSuffixes.some(suffix => wid.endsWith(suffix));
}

/**
 * Get admin WhatsApp IDs from environment
 */
export function getAdminWAIds() {
  const adminNumbers = env.ADMIN_WHATSAPP || '';
  if (!adminNumbers) {
    return [];
  }

  return adminNumbers
    .split(',')
    .map(num => num.trim())
    .filter(num => num.length > 0)
    .map(num => formatToWhatsAppId(num))
    .filter(wid => isValidWid(wid));
}

/**
 * Check if user is an admin
 */
export function isAdmin(userId) {
  const adminIds = getAdminWAIds();
  return adminIds.includes(userId);
}

/**
 * Format message with timestamp
 */
export function formatMessage(text, options = {}) {
  const lines = [];

  if (options.title) {
    lines.push(`*${options.title}*`);
    lines.push('');
  }

  lines.push(text);

  if (options.footer) {
    lines.push('');
    lines.push(options.footer);
  }

  if (options.timestamp) {
    const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    lines.push('');
    lines.push(`_${now} WIB_`);
  }

  return lines.join('\n');
}

/**
 * Extract phone number from WhatsApp ID
 * Works with both wwebjs and Baileys formats
 */
export function extractPhoneNumber(wid) {
  if (!wid) {
    return null;
  }

  // Remove all WhatsApp suffixes
  return wid.replace(/@c\.us|@s\.whatsapp\.net|@g\.us/g, '');
}

/**
 * Check if message is from group
 */
export function isGroupMessage(message) {
  return message.from.endsWith('@g.us');
}

/**
 * Check if user is mentioned in message
 */
export function isUserMentioned(message, userId) {
  if (!message.mentionedIds || message.mentionedIds.length === 0) {
    return false;
  }

  return message.mentionedIds.includes(userId);
}

/**
 * Parse command from message
 */
export function parseCommand(message) {
  const body = message.body.trim();
  if (!body.startsWith('/') && !body.startsWith('!')) {
    return null;
  }

  const parts = body.substring(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  return { command, args, raw: body };
}

/**
 * Build reply message
 */
export function buildReply(originalMessage, text) {
  return {
    body: text,
    quotedMessageId: originalMessage.id._serialized
  };
}

export default {
  formatToWhatsAppId,
  isValidWid,
  getAdminWAIds,
  isAdmin,
  formatMessage,
  extractPhoneNumber,
  isGroupMessage,
  isUserMentioned,
  parseCommand,
  buildReply
};
