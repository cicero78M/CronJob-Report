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
    console.log(`[${this.config.clientId}] Initializing WhatsApp client...`);

    try {
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
            '--disable-gpu'
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

      // Initialize the client
      await this.client.initialize();
      
      console.log(`[${this.config.clientId}] Client initialized successfully`);
    } catch (error) {
      console.error(`[${this.config.clientId}] Initialization error:`, error);
      this.isInitializing = false;
      throw error;
    }
  }

  /**
   * Set up event handlers for the WhatsApp client
   */
  _setupEventHandlers() {
    // QR Code event
    this.client.on('qr', (qr) => {
      console.log(`[${this.config.clientId}] QR Code received`);
      qrcode.generate(qr, { small: true });
      this.emit('qr', qr);
    });

    // Authenticated event
    this.client.on('authenticated', () => {
      console.log(`[${this.config.clientId}] Authentication successful`);
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful auth
      this.emit('authenticated');
    });

    // Authentication failure event
    this.client.on('auth_failure', (error) => {
      console.error(`[${this.config.clientId}] Authentication failed:`, error);
      this.isInitializing = false;
      this.emit('auth_failure', error);
    });

    // Ready event
    this.client.on('ready', () => {
      console.log(`[${this.config.clientId}] Client is ready!`);
      this.isReady = true;
      this.isInitializing = false;
      this.reconnectAttempts = 0;
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
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
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
   * Send a message
   */
  async sendMessage(to, content, options = {}) {
    if (!this.isReady) {
      throw new Error(`[${this.config.clientId}] Client is not ready`);
    }

    try {
      const result = await this.client.sendMessage(to, content, options);
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

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`[${this.config.clientId}] Timeout waiting for ready event`));
      }, timeout);

      this.once('ready', () => {
        clearTimeout(timer);
        resolve(true);
      });

      this.once('auth_failure', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
}

export default WAClient;
