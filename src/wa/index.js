/**
 * WhatsApp Bot - Main Export
 * 
 * Clean, simplified WhatsApp bot implementation following wwebjs best practices
 */

export { WAClient } from './WAClient.js';
export { WAService, waService } from './WAService.js';
export { WAMessageQueue } from './WAMessageQueue.js';
export { WAMessageDeduplicator } from './WAMessageDeduplicator.js';
export * as WAHelpers from './WAHelpers.js';

// Import and re-export for default
import { waService as defaultService } from './WAService.js';
export default defaultService;
