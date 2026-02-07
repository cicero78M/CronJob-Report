/**
 * WAClient - Simplified WhatsApp Web.js Client Wrapper
 * 
 * This module provides a clean, maintainable wrapper around whatsapp-web.js
 * following best practices and SOLID principles.
 */

import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';

const { Client, LocalAuth } = pkg;

/**
 * Configuration class for WhatsApp client
 */
class WAClientConfig {
  constructor(options = {}) {
    this.clientId = options.clientId || 'wa-client';
    this.authPath = options.authPath || path.join(os.homedir(), '.cicero', 'wwebjs_auth');
    this.puppeteerOptions = options.puppeteerOptions || {};
    this.webVersionCacheUrl = options.webVersionCacheUrl || '';
    this.webVersion = options.webVersion || '';
    // Parse as integers to handle environment variables passed as strings
    this.maxInitRetries = parseInt(options.maxInitRetries, 10) || 3;
    this.initRetryDelay = parseInt(options.initRetryDelay, 10) || 10000; // 10 seconds
    this.qrTimeout = parseInt(options.qrTimeout, 10) || 120000; // 2 minutes for QR scan
  }
}

/**
 * WhatsApp Client Wrapper
 */
export class WAClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = new WAClientConfig(config);
    this.client = null;
    this.isReady = false;
    this.isInitializing = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000; // 5 seconds
    this.initRetries = 0;
    this.qrScanned = false;
    this.authenticated = false;
    this.lastError = null;
  }

  /**
   * Initialize the WhatsApp client
   */
  async initialize() {
    if (this.isInitializing) {
      console.log(`[${this.config.clientId}] Already initializing, skipping...`);
      return;
    }

    if (this.isReady) {
      console.log(`[${this.config.clientId}] Already ready, skipping...`);
      return;
    }

    this.isInitializing = true;
    console.log(`[${this.config.clientId}] Initializing WhatsApp client (attempt ${this.initRetries + 1}/${this.config.maxInitRetries + 1})...`);

    try {
      // Destroy existing client if present
      if (this.client) {
        console.log(`[${this.config.clientId}] Cleaning up existing client...`);
        try {
          await this.client.destroy();
        } catch (err) {
          console.warn(`[${this.config.clientId}] Error destroying old client:`, err.message);
        }
        this.client = null;
      }

      // Create client with LocalAuth strategy
      const clientOptions = {
        authStrategy: new LocalAuth({
          clientId: this.config.clientId,
          dataPath: this.config.authPath
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            // NOTE: The following flags reduce security isolation but are required
            // for WhatsApp Web.js to function properly in containerized environments.
            // These flags allow the WhatsApp Web client to bypass CORS and process
            // isolation restrictions that would otherwise prevent proper operation.
            // Risk: Reduced browser security sandboxing
            // Mitigation: Client runs in isolated process, only accesses WhatsApp Web
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
          ],
          ...this.config.puppeteerOptions
        }
      };

      // Add web version cache if provided
      if (this.config.webVersionCacheUrl) {
        clientOptions.webVersionCache = {
          type: 'remote',
          remotePath: this.config.webVersionCacheUrl
        };
      } else if (this.config.webVersion) {
        clientOptions.webVersion = this.config.webVersion;
      }

      this.client = new Client(clientOptions);

      // Set up event handlers
      this._setupEventHandlers();

      // Set up QR timeout if no authentication session exists
      const qrTimeoutTimer = setTimeout(() => {
        if (!this.authenticated && !this.isReady) {
          console.warn(`[${this.config.clientId}] QR code scan timeout after ${this.config.qrTimeout}ms`);
          this._handleInitializationTimeout('QR_SCAN_TIMEOUT');
        }
      }, this.config.qrTimeout);

      // Initialize the client
      await this.client.initialize();
      
      clearTimeout(qrTimeoutTimer);
      console.log(`[${this.config.clientId}] Client initialized successfully`);
      this.initRetries = 0; // Reset retry counter on success
      this.lastError = null;
    } catch (error) {
      console.error(`[${this.config.clientId}] Initialization error:`, error);
      this.lastError = error;
      this.isInitializing = false;
      
      // Retry logic
      if (this.initRetries < this.config.maxInitRetries) {
        this.initRetries++;
        const delay = this.config.initRetryDelay * Math.pow(2, this.initRetries - 1); // Exponential backoff
        console.log(`[${this.config.clientId}] Retrying initialization in ${delay}ms...`);
        
        setTimeout(async () => {
          try {
            await this.initialize();
          } catch (retryError) {
            console.error(`[${this.config.clientId}] Retry failed:`, retryError);
            // Emit error event to notify listeners of final retry failure
            this.emit('init_retry_failed', retryError);
          }
        }, delay);
      } else {
        console.error(`[${this.config.clientId}] Maximum initialization retries (${this.config.maxInitRetries}) exceeded`);
        // Emit error event for max retries exceeded
        this.emit('init_failed', error);
        throw error;
      }
    }
  }

  /**
   * Set up event handlers for the WhatsApp client
   */
  _setupEventHandlers() {
    // QR Code event
    this.client.on('qr', (qr) => {
      console.log(`[${this.config.clientId}] QR Code received - Please scan within ${this.config.qrTimeout / 1000}s`);
      qrcode.generate(qr, { small: true });
      this.qrScanned = false;
      this.emit('qr', qr);
    });

    // Authenticated event
    this.client.on('authenticated', () => {
      console.log(`[${this.config.clientId}] Authentication successful`);
      this.authenticated = true;
      this.qrScanned = true; // Set to true when authentication succeeds (typically after QR scan or using saved session)
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful auth
      this.initRetries = 0; // Reset init retries on successful auth
      this.emit('authenticated');
    });

    // Authentication failure event
    this.client.on('auth_failure', (error) => {
      console.error(`[${this.config.clientId}] Authentication failed:`, error);
      this.authenticated = false;
      this.isInitializing = false;
      this.lastError = error;
      this.emit('auth_failure', error);
      
      // Clear authentication data on auth failure
      this._handleAuthenticationFailure();
    });

    // Ready event
    this.client.on('ready', () => {
      console.log(`[${this.config.clientId}] Client is ready!`);
      this.isReady = true;
      this.isInitializing = false;
      this.reconnectAttempts = 0;
      this.initRetries = 0;
      this.emit('ready');
    });

    // Message event
    this.client.on('message', (message) => {
      this.emit('message', message);
    });

    // Message create event (includes sent messages)
    this.client.on('message_create', (message) => {
      this.emit('message_create', message);
    });

    // Disconnected event
    this.client.on('disconnected', (reason) => {
      console.log(`[${this.config.clientId}] Client disconnected:`, reason);
      this.isReady = false;
      this.isInitializing = false;
      this.authenticated = false;
      this.emit('disconnected', reason);
      
      // Attempt to reconnect
      this._handleReconnection(reason);
    });

    // State change event
    this.client.on('change_state', (state) => {
      console.log(`[${this.config.clientId}] State changed:`, state);
      this.emit('change_state', state);
    });

    // Loading screen event
    this.client.on('loading_screen', (percent, message) => {
      console.log(`[${this.config.clientId}] Loading: ${percent}% - ${message}`);
      this.emit('loading_screen', percent, message);
    });
  }

  /**
   * Handle reconnection logic
   */
  async _handleReconnection(reason) {
    // Don't reconnect if logged out or max attempts reached
    const noReconnectReasons = ['LOGGED_OUT', 'UNPAIRED'];
    if (noReconnectReasons.includes(reason) || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`[${this.config.clientId}] Not attempting reconnection. Reason: ${reason}, Attempts: ${this.reconnectAttempts}`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * (2 ** (this.reconnectAttempts - 1)); // Exponential backoff
    
    console.log(`[${this.config.clientId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    setTimeout(async () => {
      try {
        await this.initialize();
      } catch (error) {
        console.error(`[${this.config.clientId}] Reconnection failed:`, error);
      }
    }, delay);
  }

  /**
   * Handle authentication failure by cleaning up session
   */
  async _handleAuthenticationFailure() {
    console.warn(`[${this.config.clientId}] Handling authentication failure...`);
    
    // If we've failed multiple times, clear the authentication session
    if (this.initRetries >= 1) {
      console.log(`[${this.config.clientId}] Clearing authentication session due to repeated failures...`);
      try {
        if (this.client) {
          await this.client.destroy();
          this.client = null;
        }
        // Note: The LocalAuth strategy will handle session cleanup
        // We just need to destroy the client and let it reinitialize
      } catch (err) {
        console.error(`[${this.config.clientId}] Error clearing session:`, err);
      }
    }
  }

  /**
   * Handle initialization timeout
   */
  async _handleInitializationTimeout(reason) {
    console.warn(`[${this.config.clientId}] Initialization timeout: ${reason}`);
    this.isInitializing = false;
    
    try {
      if (this.client) {
        await this.client.destroy();
        this.client = null;
      }
    } catch (err) {
      console.error(`[${this.config.clientId}] Error cleaning up on timeout:`, err);
    }

    // Trigger a retry if we haven't exceeded max retries
    if (this.initRetries < this.config.maxInitRetries) {
      this.initRetries++;
      const delay = this.config.initRetryDelay * Math.pow(2, this.initRetries - 1);
      console.log(`[${this.config.clientId}] Retrying after timeout in ${delay}ms...`);
      
      setTimeout(async () => {
        try {
          await this.initialize();
        } catch (error) {
          console.error(`[${this.config.clientId}] Retry after timeout failed:`, error);
          // Emit error event to notify listeners of timeout retry failure
          this.emit('timeout_retry_failed', error);
        }
      }, delay);
    } else {
      // Max retries exceeded after timeout
      console.error(`[${this.config.clientId}] Maximum retries exceeded after ${reason}`);
      const timeoutError = new Error(`[${this.config.clientId}] ${reason}: Maximum retries (${this.config.maxInitRetries}) exceeded`);
      this.lastError = timeoutError;
      this.emit('init_failed', timeoutError);
    }
  }

  /**
   * Send a message
   */
  async sendMessage(to, content, options = {}) {
    if (!this.isReady) {
      throw new Error(`[${this.config.clientId}] Client is not ready`);
    }

    try {
      // Normalize options to prevent "Cannot read properties of undefined (reading 'markedUnread')" error
      // Ensure options is always an object, never null or undefined
      const normalizedOptions = options || {};

      const result = await this.client.sendMessage(to, content, normalizedOptions);
      return result;
    } catch (error) {
      console.error(`[${this.config.clientId}] Error sending message:`, error);
      throw error;
    }
  }

  /**
   * Get client info
   */
  async getInfo() {
    if (!this.isReady) {
      throw new Error(`[${this.config.clientId}] Client is not ready`);
    }

    return this.client.info;
  }

  /**
   * Get client state
   */
  async getState() {
    try {
      if (!this.client) {
        return 'NOT_INITIALIZED';
      }
      const state = await this.client.getState();
      return state;
    } catch (error) {
      console.error(`[${this.config.clientId}] Error getting state:`, error);
      return 'ERROR';
    }
  }

  /**
   * Check if number is registered on WhatsApp
   */
  async isRegisteredUser(number) {
    if (!this.isReady) {
      throw new Error(`[${this.config.clientId}] Client is not ready`);
    }

    try {
      const numberId = await this.client.getNumberId(number);
      return numberId !== null;
    } catch (error) {
      console.error(`[${this.config.clientId}] Error checking number:`, error);
      return false;
    }
  }

  /**
   * Destroy the client
   */
  async destroy() {
    console.log(`[${this.config.clientId}] Destroying client...`);
    
    if (this.client) {
      try {
        await this.client.destroy();
        this.client = null;
        this.isReady = false;
        this.isInitializing = false;
        console.log(`[${this.config.clientId}] Client destroyed successfully`);
      } catch (error) {
        console.error(`[${this.config.clientId}] Error destroying client:`, error);
      }
    }
  }

  /**
   * Wait for client to be ready
   */
  async waitForReady(timeout = 60000) {
    if (this.isReady) {
      return true;
    }

    // Check if client is even initialized
    if (!this.client) {
      throw new Error(`[${this.config.clientId}] Client not initialized. Call initialize() first.`);
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stateCheckInterval = null;
      
      const timer = setTimeout(() => {
        const elapsed = Date.now() - startTime;
        const state = this.isInitializing ? 'initializing' : 'unknown';
        
        // Clean up listeners and interval on timeout
        cleanup();
        
        // Build detailed error message
        let errorMsg = `[${this.config.clientId}] Timeout waiting for ready event after ${elapsed}ms. `;
        errorMsg += `Current state: ${state}. `;
        
        if (!this.authenticated && !this.qrScanned) {
          errorMsg += `Authentication status: Not authenticated (QR code may need to be scanned). `;
        } else if (this.authenticated && !this.isReady) {
          errorMsg += `Authentication status: Authenticated but not ready (loading). `;
        }
        
        if (this.lastError) {
          errorMsg += `Last error: ${this.lastError.message || this.lastError}. `;
        }
        
        errorMsg += `Possible causes: `;
        errorMsg += `1) WhatsApp Web QR code needs to be scanned (check console for QR code), `;
        errorMsg += `2) Network connectivity issues or firewall blocking WhatsApp Web, `;
        errorMsg += `3) WhatsApp Web service is temporarily down, `;
        errorMsg += `4) Corrupted authentication session (try clearing ${this.config.authPath}). `;
        errorMsg += `Suggestions: `;
        errorMsg += `1) Increase timeout value, `;
        errorMsg += `2) Check network connectivity and firewall rules, `;
        errorMsg += `3) Ensure no other WhatsApp Web sessions are active with the same phone, `;
        errorMsg += `4) Clear authentication data and scan QR code again.`;
        
        reject(new Error(errorMsg));
      }, timeout);

      const cleanup = () => {
        clearTimeout(timer);
        if (stateCheckInterval) {
          clearInterval(stateCheckInterval);
        }
        this.removeAllListeners('ready');
        this.removeAllListeners('auth_failure');
        this.removeAllListeners('disconnected');
      };

      // Set up state polling fallback mechanism
      // This checks if the client is actually ready even if the ready event doesn't fire
      // which can happen when WhatsApp Web gets stuck in loading state after authentication
      stateCheckInterval = setInterval(async () => {
        try {
          // Only check state if authenticated but not ready yet
          if (this.authenticated && !this.isReady) {
            const state = await this.getState();
            console.log(`[${this.config.clientId}] State check: ${state}`);
            
            // If state is CONNECTED, mark as ready even if event didn't fire
            if (state === 'CONNECTED' || state === 'open') {
              console.log(`[${this.config.clientId}] Client is ready via state check (fallback mechanism)`);
              this.isReady = true;
              this.isInitializing = false;
              cleanup();
              // Emit the ready event manually since it wasn't emitted by the underlying client
              this.emit('ready');
              resolve(true);
            }
          }
        } catch (error) {
          // Silently ignore state check errors to avoid noise during normal operation
          // The timeout will handle the error case if state checks keep failing
          // However, log unexpected errors for debugging
          if (error && error.message && !error.message.includes('not initialized') && !error.message.includes('ERR_')) {
            console.warn(`[${this.config.clientId}] Unexpected error during state check:`, error.message);
          }
        }
      }, 5000); // Check every 5 seconds

      this.once('ready', () => {
        cleanup();
        resolve(true);
      });

      this.once('auth_failure', (error) => {
        cleanup();
        reject(new Error(`[${this.config.clientId}] Authentication failed: ${error.message || error}`));
      });

      // Also listen for disconnection during wait
      this.once('disconnected', (reason) => {
        cleanup();
        reject(new Error(`[${this.config.clientId}] Disconnected while waiting for ready: ${reason}`));
      });
    });
  }
}

export default WAClient;
