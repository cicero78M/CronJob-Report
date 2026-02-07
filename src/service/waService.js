/**
 * WA Service - Compatibility Export
 * 
 * This file provides backward compatibility with the old waService interface
 * while using the new simplified architecture under the hood.
 */

import { waService, WAClientCompat } from '../wa/compatibility.js';
import { formatToWhatsAppId, getAdminWAIds, isAdmin } from '../wa/WAHelpers.js';
import { env } from '../config/env.js';

// State management
let initPromise = null;
let _waClient = null;
let _waGatewayClient = null;

// Initialize function that is called from app.js
export async function initializeWAService() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Create admin client
      waService.createClient('wa-client', {
        clientId: env.APP_SESSION_NAME || 'wa-admin',
        authPath: env.WA_AUTH_DATA_PATH,
        webVersionCacheUrl: env.WA_WEB_VERSION_CACHE_URL,
        webVersion: env.WA_WEB_VERSION
      });

      // Create gateway client
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

      // Create client instances after initialization completes
      _waClient = new WAClientCompat('wa-client');
      _waGatewayClient = new WAClientCompat('wa-gateway');

      console.log('[waService] Clients initialized successfully');
    } catch (error) {
      console.error('[waService] Failed to initialize clients:', error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Wait for initialization to complete
 */
export async function waitForInitialization() {
  if (!initPromise) {
    throw new Error('[waService] Service not initialized. Call initializeWAService() first.');
  }
  return initPromise;
}

/**
 * Wait for all message queues
 */
export async function waitForAllMessageQueues() {
  // Wait for initialization
  if (!initPromise) {
    throw new Error('[waService] Service not initialized. Call initializeWAService() first.');
  }
  await initPromise;
  
  // Wait for all clients to be ready
  await waService.waitForAllReady();
}

/**
 * Wait for WA ready (compatibility function)
 */
export async function waitForWaReady(clientId = 'wa-client', timeout = 60000) {
  // Wait for initialization to complete first
  if (!initPromise) {
    throw new Error('[waService] Service not initialized. Call initializeWAService() first.');
  }
  await initPromise;
  
  const client = waService.getClient(clientId);
  if (!client) {
    throw new Error(`Client ${clientId} not found`);
  }
  return client.waitForReady(timeout);
}

// Export compatibility layer
export { formatToWhatsAppId, getAdminWAIds, isAdmin };

// Export getter functions for client instances
export function getWAClient() {
  if (!_waClient) {
    throw new Error('[waService] waClient not initialized. Call initializeWAService() first.');
  }
  return _waClient;
}

export function getWAGatewayClient() {
  if (!_waGatewayClient) {
    throw new Error('[waService] waGatewayClient not initialized. Call initializeWAService() first.');
  }
  return _waGatewayClient;
}

// Create proxy objects for backward compatibility
// These allow code to import waClient directly but delay access until initialization
const waClientHandler = {
  get(target, prop) {
    if (!_waClient) {
      throw new Error('[waService] waClient not initialized. Ensure initializeWAService() is called first.');
    }
    const value = _waClient[prop];
    return typeof value === 'function' ? value.bind(_waClient) : value;
  }
};

const waGatewayClientHandler = {
  get(target, prop) {
    if (!_waGatewayClient) {
      throw new Error('[waService] waGatewayClient not initialized. Ensure initializeWAService() is called first.');
    }
    const value = _waGatewayClient[prop];
    return typeof value === 'function' ? value.bind(_waGatewayClient) : value;
  }
};

// Export proxy objects for backward compatibility
export const waClient = new Proxy({}, waClientHandler);
export const waGatewayClient = new Proxy({}, waGatewayClientHandler);

// Default export
export default waClient;
