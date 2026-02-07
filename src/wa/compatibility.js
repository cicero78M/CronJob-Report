/**
 * Compatibility Layer
 * 
 * Provides backward compatibility with the old waService interface
 * This allows gradual migration without breaking existing code
 */

import { waService } from './WAService.js';
import { formatToWhatsAppId, getAdminWAIds, isAdmin } from './WAHelpers.js';
import { env } from '../config/env.js';

/**
 * Create clients with the same names as before
 */
export async function initializeClients() {
  console.log('[Compatibility] Initializing WhatsApp clients...');

  // Create main admin client
  const waClient = waService.createClient('wa-client', {
    clientId: env.APP_SESSION_NAME || 'wa-admin'
  });

  // Create gateway client
  const waGatewayClient = waService.createClient('wa-gateway', {
    clientId: env.GATEWAY_WA_CLIENT_ID || 'wa-gateway-prod'
  });

  // Initialize clients in parallel
  await Promise.all([
    waClient.initialize(),
    waGatewayClient.initialize()
  ]);

  console.log('[Compatibility] Clients initialized');

  return { waClient, waGatewayClient };
}

/**
 * Compatibility wrapper for waClient
 */
export class WAClientCompat {
  constructor(clientId) {
    this.clientId = clientId;
    this._client = waService.getClient(clientId);
    this._queue = waService.getQueue(clientId);
  }

  get client() {
    return this._client?.client;
  }

  get isReady() {
    return this._client?.isReady || false;
  }

  async sendMessage(to, content, options = {}) {
    return waService.sendMessage(this.clientId, to, content, options);
  }

  async waitForWaReady(timeout = 60000) {
    if (!this._client) {
      throw new Error(`[WAClientCompat] Client ${this.clientId} not found`);
    }
    return this._client.waitForReady(timeout);
  }

  on(event, handler) {
    if (this._client) {
      this._client.on(event, handler);
    }
  }

  once(event, handler) {
    if (this._client) {
      this._client.once(event, handler);
    }
  }

  async getInfo() {
    return this._client.getInfo();
  }

  async getState() {
    return this._client.getState();
  }
}

// Export helpers
export { formatToWhatsAppId, getAdminWAIds, isAdmin };

// Export service instance
export { waService };

export default {
  initializeClients,
  WAClientCompat,
  formatToWhatsAppId,
  getAdminWAIds,
  isAdmin,
  waService
};
