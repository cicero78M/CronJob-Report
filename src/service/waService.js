/**
 * WA Service - Compatibility Export
 * 
 * This file provides backward compatibility with the old waService interface
 * while using the new simplified architecture under the hood.
 */

import { waService, WAClientCompat } from '../wa/compatibility.js';
import { formatToWhatsAppId, getAdminWAIds, isAdmin } from '../wa/WAHelpers.js';
import { env } from '../config/env.js';

// Create client instances
const waClient = new WAClientCompat('wa-client');
const waGatewayClient = new WAClientCompat('wa-gateway');

// Initialize clients on first import
const initPromise = (async () => {
  try {
    // Initialize admin client
    waService.createClient('wa-client', {
      clientId: env.APP_SESSION_NAME || 'wa-admin',
      authPath: env.WA_AUTH_DATA_PATH,
      webVersionCacheUrl: env.WA_WEB_VERSION_CACHE_URL,
      webVersion: env.WA_WEB_VERSION
    });

    // Initialize gateway client
    waService.createClient('wa-gateway', {
      clientId: env.GATEWAY_WA_CLIENT_ID || 'wa-gateway-prod',
      authPath: env.WA_AUTH_DATA_PATH,
      webVersionCacheUrl: env.WA_WEB_VERSION_CACHE_URL,
      webVersion: env.WA_WEB_VERSION
    });

    // Start initialization
    await Promise.all([
      waService.initializeClient('wa-client'),
      waService.initializeClient('wa-gateway')
    ]);

    console.log('[waService] Clients initialized successfully');
  } catch (error) {
    console.error('[waService] Failed to initialize clients:', error);
    throw error;
  }
})();

/**
 * Wait for all message queues
 */
export async function waitForAllMessageQueues() {
  // Wait for initialization
  await initPromise;
  
  // Wait for all clients to be ready
  await waService.waitForAllReady();
}

/**
 * Wait for WA ready (compatibility function)
 */
export async function waitForWaReady(clientId = 'wa-client', timeout = 60000) {
  await initPromise;
  const client = waService.getClient(clientId);
  if (!client) {
    throw new Error(`Client ${clientId} not found`);
  }
  return client.waitForReady(timeout);
}

// Export compatibility layer
export { formatToWhatsAppId, getAdminWAIds, isAdmin };

// Export client instances
export { waClient as default, waGatewayClient };
