/**
 * WAService - Main WhatsApp Service
 * 
 * Coordinates multiple WhatsApp clients with message handling,
 * queue management, and deduplication.
 */

import { WAClient } from './WAClient.js';
import { WAMessageQueue } from './WAMessageQueue.js';
import { WAMessageDeduplicator } from './WAMessageDeduplicator.js';
import { env } from '../config/env.js';
import path from 'path';
import os from 'os';

/**
 * WhatsApp Service Manager
 */
export class WAService {
  constructor() {
    this.clients = new Map();
    this.queues = new Map();
    this.deduplicator = new WAMessageDeduplicator();
    this.messageHandlers = [];
    
    console.log('[WAService] Service initialized');
  }

  /**
   * Create and register a new WhatsApp client
   * Updated for Baileys compatibility
   */
  createClient(clientId, options = {}) {
    if (this.clients.has(clientId)) {
      console.log(`[WAService] Client ${clientId} already exists`);
      return this.clients.get(clientId);
    }

    const config = {
      clientId,
      authPath: options.authPath || env.WA_AUTH_DATA_PATH || path.join(os.homedir(), '.cicero', 'baileys_auth'),
      // Baileys-specific options
      logLevel: options.logLevel || 'error',
      maxInitRetries: options.maxInitRetries || env.WA_INIT_MAX_RETRIES,
      initRetryDelay: options.initRetryDelay || env.WA_INIT_RETRY_DELAY_MS,
      qrTimeout: options.qrTimeout || env.WA_QR_TIMEOUT_MS
    };

    const client = new WAClient(config);
    const queue = new WAMessageQueue({ clientId });

    // Set up message handler
    client.on('message', (message) => {
      this._handleIncomingMessage(clientId, message);
    });

    // Store client and queue
    this.clients.set(clientId, client);
    this.queues.set(clientId, queue);

    console.log(`[WAService] Client ${clientId} created with Baileys`);
    return client;
  }

  /**
   * Initialize a client
   */
  async initializeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error(`[WAService] Client ${clientId} not found`);
    }

    await client.initialize();
  }

  /**
   * Get a client by ID
   */
  getClient(clientId) {
    return this.clients.get(clientId);
  }

  /**
   * Get queue for a client
   */
  getQueue(clientId) {
    return this.queues.get(clientId);
  }

  /**
   * Send a message through a specific client
   */
  async sendMessage(clientId, to, content, options = {}) {
    const client = this.clients.get(clientId);
    const queue = this.queues.get(clientId);

    if (!client || !queue) {
      throw new Error(`[WAService] Client ${clientId} not found`);
    }

    // Normalize options to ensure it's always an object
    const normalizedOptions = options || {};

    return queue.schedule(client, to, content, normalizedOptions);
  }

  /**
   * Register a message handler
   */
  onMessage(handler) {
    if (typeof handler !== 'function') {
      throw new Error('[WAService] Message handler must be a function');
    }
    this.messageHandlers.push(handler);
  }

  /**
   * Handle incoming messages
   */
  async _handleIncomingMessage(clientId, message) {
    // Check for duplicates
    const messageId = message.id?._serialized || message.id?.id || message.id;
    if (!messageId) {
      console.warn(`[WAService] Message without ID received from ${clientId}`);
      return;
    }
    
    const messageKey = `${clientId}:${messageId}`;
    if (this.deduplicator.isDuplicate(messageKey)) {
      console.log(`[WAService] Duplicate message ignored: ${messageKey}`);
      return;
    }

    // Mark as processed
    this.deduplicator.markProcessed(messageKey);

    // Call all registered handlers
    for (const handler of this.messageHandlers) {
      try {
        await handler(clientId, message);
      } catch (error) {
        console.error(`[WAService] Error in message handler:`, error);
      }
    }
  }

  /**
   * Wait for all clients to be ready
   * Returns an object with success/failure status for each client
   */
  async waitForAllReady(timeout = 60000) {
    const promises = [];
    const clientIds = [];
    
    for (const [clientId, client] of this.clients.entries()) {
      clientIds.push(clientId);
      promises.push(
        client.waitForReady(timeout)
          .then(() => ({ clientId, status: 'success', ready: true }))
          .catch(error => {
            console.error(`[WAService] Client ${clientId} failed to ready:`, error);
            return { clientId, status: 'failed', ready: false, error: error.message };
          })
      );
    }
    
    const results = await Promise.all(promises);
    
    // Log summary of client initialization
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    
    console.log(`[WAService] Client initialization complete: ${successCount} succeeded, ${failedCount} failed`);
    
    results.forEach(result => {
      if (result.status === 'success') {
        console.log(`[WAService] ✓ Client ${result.clientId} is ready`);
      } else {
        console.warn(`[WAService] ✗ Client ${result.clientId} failed: ${result.error}`);
      }
    });
    
    // Return results for caller to decide how to handle
    return results;
  }

  /**
   * Get service statistics
   */
  getStats() {
    const stats = {
      clients: {},
      deduplicator: this.deduplicator.getStats()
    };

    for (const [clientId, client] of this.clients.entries()) {
      const queue = this.queues.get(clientId);
      stats.clients[clientId] = {
        isReady: client.isReady,
        isInitializing: client.isInitializing,
        reconnectAttempts: client.reconnectAttempts,
        queueCounts: queue ? queue.counts() : null
      };
    }

    return stats;
  }

  /**
   * Destroy all clients and cleanup
   */
  async destroy() {
    console.log('[WAService] Destroying service...');

    // Destroy all clients
    for (const client of this.clients.values()) {
      await client.destroy();
    }

    // Disconnect all queues
    for (const queue of this.queues.values()) {
      await queue.disconnect();
    }

    // Cleanup deduplicator
    this.deduplicator.destroy();

    // Clear maps
    this.clients.clear();
    this.queues.clear();
    this.messageHandlers = [];

    console.log('[WAService] Service destroyed');
  }
}

// Create singleton instance
export const waService = new WAService();

export default waService;
