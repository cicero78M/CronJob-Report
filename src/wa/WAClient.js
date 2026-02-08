/**
 * WAClient - WhatsApp Client Wrapper using Baileys
 * 
 * This module provides a clean, maintainable wrapper around Baileys
 * following best practices, SOLID principles, and naming conventions.
 * Migrated from whatsapp-web.js to Baileys for better performance and lower resource usage.
 */

import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { EventEmitter } from 'events';
import path from 'path';
import os from 'os';

/**
 * Configuration class for WhatsApp client
 * Following camelCase naming convention for class properties
 */
class WAClientConfig {
  constructor(options = {}) {
    this.clientId = options.clientId || 'wa-client';
    this.authPath = options.authPath || path.join(os.homedir(), '.cicero', 'baileys_auth');
    // Parse as integers to handle environment variables passed as strings
    this.maxInitRetries = parseInt(options.maxInitRetries, 10) || 3;
    this.initRetryDelay = parseInt(options.initRetryDelay, 10) || 10000; // 10 seconds
    this.qrTimeout = parseInt(options.qrTimeout, 10) || 120000; // 2 minutes for QR scan
    this.logLevel = options.logLevel || 'error'; // Baileys logging level
  }
}

/**
 * WhatsApp Client Wrapper using Baileys
 * Maintains compatibility with existing interface while using Baileys backend
 */
export class WAClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = new WAClientConfig(config);
    this.socket = null; // Baileys socket connection
    this.authState = null; // Authentication state
    this.saveCreds = null; // Credentials save function
    this.isReady = false;
    this.isInitializing = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000; // 5 seconds
    this.initRetries = 0;
    this.qrScanned = false;
    this.authenticated = false;
    this.lastError = null;
    this.qrTimeoutTimer = null;
    this.reconnectTimer = null;
  }

  /**
   * Initialize the WhatsApp client with Baileys
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
    console.log(`[${this.config.clientId}] Initializing WhatsApp client with Baileys (attempt ${this.initRetries + 1}/${this.config.maxInitRetries + 1})...`);

    try {
      // Destroy existing socket if present
      if (this.socket) {
        console.log(`[${this.config.clientId}] Cleaning up existing socket...`);
        try {
          this.socket.end(undefined);
        } catch (err) {
          console.warn(`[${this.config.clientId}] Error destroying old socket:`, err.message);
        }
        this.socket = null;
      }

      // Set up authentication state using Baileys multi-file auth
      const authPath = path.join(this.config.authPath, this.config.clientId);
      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      this.authState = state;
      this.saveCreds = saveCreds;

      // Fetch latest Baileys version for compatibility
      const { version } = await fetchLatestBaileysVersion();

      // Create Baileys socket with configuration
      this.socket = makeWASocket({
        auth: this.authState,
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: this.config.logLevel }),
        printQRInTerminal: false, // We handle QR display manually
        shouldSyncHistoryMessage: false, // Don't sync message history
        version: version,
        getMessage: async () => {
          // Return undefined to indicate message not found in cache
          return undefined;
        }
      });

      // Set up event handlers
      this._setupEventHandlers();

      // Set up QR timeout if no authentication session exists
      this.qrTimeoutTimer = setTimeout(() => {
        if (!this.authenticated && !this.isReady) {
          console.warn(`[${this.config.clientId}] QR code scan timeout after ${this.config.qrTimeout}ms`);
          this._handleInitializationTimeout('QR_SCAN_TIMEOUT');
        }
      }, this.config.qrTimeout);

      console.log(`[${this.config.clientId}] Client socket created successfully`);
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
        
        this.reconnectTimer = setTimeout(async () => {
          try {
            await this.initialize();
          } catch (retryError) {
            console.error(`[${this.config.clientId}] Retry failed:`, retryError);
            this.emit('init_retry_failed', retryError);
          }
        }, delay);
      } else {
        console.error(`[${this.config.clientId}] Maximum initialization retries (${this.config.maxInitRetries}) exceeded`);
        this.emit('init_failed', error);
        throw error;
      }
    }
  }

  /**
   * Set up event handlers for the Baileys socket
   * Maps Baileys events to maintain compatibility with previous interface
   */
  _setupEventHandlers() {
    // Connection state updates - handles QR, authentication, ready state
    this.socket.ev.on('connection.update', (update) => {
      const { connection, qr, lastDisconnect } = update;

      // Handle QR code display
      if (qr) {
        console.log(`[${this.config.clientId}] QR Code received - Please scan within ${this.config.qrTimeout / 1000}s`);
        qrcode.generate(qr, { small: true });
        this.qrScanned = false;
        this.emit('qr', qr);
      }

      // Handle connection opened (ready state)
      if (connection === 'open') {
        console.log(`[${this.config.clientId}] Client is ready!`);
        this.isReady = true;
        this.isInitializing = false;
        this.authenticated = true;
        this.qrScanned = true;
        this.reconnectAttempts = 0;
        this.initRetries = 0;
        
        // Clear QR timeout
        if (this.qrTimeoutTimer) {
          clearTimeout(this.qrTimeoutTimer);
          this.qrTimeoutTimer = null;
        }
        
        this.emit('authenticated');
        this.emit('ready');
      }

      // Handle connection closed (disconnection)
      if (connection === 'close') {
        console.log(`[${this.config.clientId}] Client disconnected`);
        this.isReady = false;
        this.isInitializing = false;
        this.authenticated = false;

        // Determine disconnect reason with comprehensive mapping
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || '';
        
        // Map all Baileys disconnect reasons for better diagnostics
        let reason = 'UNKNOWN';
        let shouldReconnect = true;
        
        if (statusCode === DisconnectReason.loggedOut) {
          reason = 'LOGGED_OUT';
          shouldReconnect = false;
        } else if (statusCode === DisconnectReason.forbidden) {
          reason = 'FORBIDDEN';
          shouldReconnect = false;
        } else if (statusCode === DisconnectReason.multideviceMismatch) {
          reason = 'MULTIDEVICE_MISMATCH';
          shouldReconnect = false;
        } else if (statusCode === DisconnectReason.connectionClosed) {
          reason = 'CONNECTION_CLOSED';
        } else if (statusCode === DisconnectReason.connectionLost) {
          reason = 'CONNECTION_LOST';
        } else if (statusCode === DisconnectReason.timedOut) {
          reason = 'TIMED_OUT';
        } else if (statusCode === DisconnectReason.connectionReplaced) {
          reason = 'CONNECTION_REPLACED';
          shouldReconnect = false;
        } else if (statusCode === DisconnectReason.badSession) {
          reason = 'BAD_SESSION';
          shouldReconnect = false;
        } else if (statusCode === DisconnectReason.restartRequired) {
          reason = 'RESTART_REQUIRED';
        } else if (statusCode === DisconnectReason.unavailableService) {
          reason = 'UNAVAILABLE_SERVICE';
        } else if (statusCode !== undefined) {
          // Unknown status code - log separately for debugging but keep reason as UNKNOWN
          console.warn(`[${this.config.clientId}] Unrecognized disconnect status code: ${statusCode}`);
        }
        
        // Log disconnect with details for troubleshooting
        console.log(`[${this.config.clientId}] Disconnect reason: ${reason}${statusCode ? ` (code: ${statusCode})` : ''}${errorMessage ? `, error: ${errorMessage}` : ''}`);

        this.emit('disconnected', reason);
        
        // Attempt to reconnect based on disconnect reason
        if (shouldReconnect) {
          this._handleReconnection(reason);
        } else {
          console.log(`[${this.config.clientId}] Not attempting reconnection due to: ${reason}`);
        }
      }

      // Handle connecting state (loading)
      if (connection === 'connecting') {
        console.log(`[${this.config.clientId}] Connecting...`);
        this.emit('change_state', 'CONNECTING');
      }
    });

    // Credentials update - must save to persist authentication
    this.socket.ev.on('creds.update', () => {
      if (this.saveCreds) {
        this.saveCreds();
      }
    });

    // Incoming messages
    this.socket.ev.on('messages.upsert', ({ messages, type }) => {
      for (const msg of messages) {
        // Skip if message is from us
        if (msg.key.fromMe) {
          // Emit message_create for sent messages
          const convertedMsg = this._convertBaileysMessage(msg);
          this.emit('message_create', convertedMsg);
          continue;
        }

        // Only process notify type messages (new messages)
        if (type === 'notify' && msg.message) {
          const convertedMsg = this._convertBaileysMessage(msg);
          this.emit('message', convertedMsg);
        }
      }
    });

    // Message updates (status changes, reactions, etc.)
    this.socket.ev.on('messages.update', (updates) => {
      // Handle message status updates if needed
      // This can be used for message delivery/read receipts
      for (const update of updates) {
        if (update.update?.status) {
          // Emit message status change events if needed
        }
      }
    });
  }

  /**
   * Convert Baileys message format to whatsapp-web.js compatible format
   * for backward compatibility with existing code
   */
  _convertBaileysMessage(baileyMsg) {
    // Extract text content from various message types
    let body = '';
    const msg = baileyMsg.message;
    
    if (msg?.conversation) {
      body = msg.conversation;
    } else if (msg?.extendedTextMessage?.text) {
      body = msg.extendedTextMessage.text;
    } else if (msg?.imageMessage?.caption) {
      body = msg.imageMessage.caption;
    } else if (msg?.videoMessage?.caption) {
      body = msg.videoMessage.caption;
    } else if (msg?.documentMessage?.caption) {
      body = msg.documentMessage.caption;
    }

    // Check for media types
    const hasMedia = !!(
      msg?.imageMessage ||
      msg?.videoMessage ||
      msg?.audioMessage ||
      msg?.documentMessage ||
      msg?.stickerMessage
    );

    // Build compatible message object
    return {
      id: {
        id: baileyMsg.key.id,
        _serialized: baileyMsg.key.id,
        fromMe: baileyMsg.key.fromMe || false
      },
      body: body,
      from: baileyMsg.key.remoteJid,
      to: this.socket?.user?.id || '',
      hasMedia: hasMedia,
      timestamp: baileyMsg.messageTimestamp,
      // Add raw Baileys message for advanced use
      _raw: baileyMsg,
      // Mentioned IDs (for group messages with mentions)
      mentionedIds: msg?.extendedTextMessage?.contextInfo?.mentionedJid || [],
      // Check if from group
      isGroup: baileyMsg.key.remoteJid?.endsWith('@g.us') || false
    };
  }

  /**
   * Handle reconnection logic
   */
  async _handleReconnection(reason) {
    // Don't reconnect for terminal disconnect reasons or if max attempts reached
    const noReconnectReasons = [
      'LOGGED_OUT',
      'UNPAIRED', 
      'FORBIDDEN',
      'MULTIDEVICE_MISMATCH',
      'CONNECTION_REPLACED',
      'BAD_SESSION'
    ];
    
    if (noReconnectReasons.includes(reason) || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`[${this.config.clientId}] Not attempting reconnection. Reason: ${reason}, Attempts: ${this.reconnectAttempts}`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * (2 ** (this.reconnectAttempts - 1)); // Exponential backoff
    
    console.log(`[${this.config.clientId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.initialize();
      } catch (error) {
        console.error(`[${this.config.clientId}] Reconnection failed:`, error);
      }
    }, delay);
  }

  /**
   * Handle initialization timeout
   */
  async _handleInitializationTimeout(reason) {
    console.warn(`[${this.config.clientId}] Initialization timeout: ${reason}`);
    this.isInitializing = false;
    
    try {
      if (this.socket) {
        this.socket.end(undefined);
        this.socket = null;
      }
    } catch (err) {
      console.error(`[${this.config.clientId}] Error cleaning up on timeout:`, err);
    }

    // Trigger a retry if we haven't exceeded max retries
    if (this.initRetries < this.config.maxInitRetries) {
      this.initRetries++;
      const delay = this.config.initRetryDelay * Math.pow(2, this.initRetries - 1);
      console.log(`[${this.config.clientId}] Retrying after timeout in ${delay}ms...`);
      
      this.reconnectTimer = setTimeout(async () => {
        try {
          await this.initialize();
        } catch (error) {
          console.error(`[${this.config.clientId}] Retry after timeout failed:`, error);
          this.emit('timeout_retry_failed', error);
        }
      }, delay);
    } else {
      console.error(`[${this.config.clientId}] Maximum retries exceeded after ${reason}`);
      const timeoutError = new Error(`[${this.config.clientId}] ${reason}: Maximum retries (${this.config.maxInitRetries}) exceeded`);
      this.lastError = timeoutError;
      this.emit('init_failed', timeoutError);
    }
  }

  /**
   * Send a message using Baileys
   * Maintains compatibility with whatsapp-web.js interface
   */
  async sendMessage(to, content, options = {}) {
    if (!this.isReady) {
      throw new Error(`[${this.config.clientId}] Client is not ready`);
    }

    try {
      // Normalize options to prevent undefined errors
      const normalizedOptions = options || {};

      // Format message for Baileys
      let message;
      if (typeof content === 'string') {
        // Simple text message
        message = { text: content };
      } else if (content && typeof content === 'object') {
        // Already formatted message object
        message = content;
      } else {
        throw new Error(`[${this.config.clientId}] Invalid message content type`);
      }

      // Normalize JID format - Baileys uses @s.whatsapp.net, convert @c.us if needed
      const normalizedJid = to.replace('@c.us', '@s.whatsapp.net');

      // Send message using Baileys socket
      const result = await this.socket.sendMessage(normalizedJid, message, {
        quoted: normalizedOptions.quoted,
        ...normalizedOptions
      });
      
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

    // Return user info in compatible format
    return {
      wid: this.socket.user?.id || '',
      pushname: this.socket.user?.name || '',
      ...this.socket.user
    };
  }

  /**
   * Get client state
   * Maps Baileys socket state to whatsapp-web.js state names
   */
  async getState() {
    try {
      if (!this.socket) {
        return 'NOT_INITIALIZED';
      }
      
      // Check socket ready state
      const wsState = this.socket.ws?.readyState;
      
      if (wsState === 1) { // WebSocket.OPEN
        return 'CONNECTED';
      } else if (wsState === 0) { // WebSocket.CONNECTING
        return 'CONNECTING';
      } else if (wsState === 2 || wsState === 3) { // WebSocket.CLOSING or CLOSED
        return 'DISCONNECTED';
      }
      
      return 'UNKNOWN';
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
      // Normalize number format
      const normalizedNumber = number.replace('@c.us', '').replace('@s.whatsapp.net', '');
      const jid = `${normalizedNumber}@s.whatsapp.net`;
      
      // Use Baileys onWhatsApp function
      const [result] = await this.socket.onWhatsApp(jid);
      return result?.exists || false;
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
    
    // Clear any pending timers
    if (this.qrTimeoutTimer) {
      clearTimeout(this.qrTimeoutTimer);
      this.qrTimeoutTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.socket) {
      try {
        this.socket.end(undefined); // Graceful close
        this.socket = null;
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
   * Compatible with both legacy code and new Baileys implementation
   */
  async waitForReady(timeout = 60000) {
    if (this.isReady) {
      return true;
    }

    // Check if socket is even initialized
    if (!this.socket) {
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
        errorMsg += `1) WhatsApp QR code needs to be scanned (check console for QR code), `;
        errorMsg += `2) Network connectivity issues or firewall blocking WhatsApp, `;
        errorMsg += `3) WhatsApp service is temporarily down, `;
        errorMsg += `4) Corrupted authentication session (try clearing ${this.config.authPath}). `;
        errorMsg += `Suggestions: `;
        errorMsg += `1) Increase timeout value, `;
        errorMsg += `2) Check network connectivity and firewall rules, `;
        errorMsg += `3) Ensure no other WhatsApp sessions are active with the same phone, `;
        errorMsg += `4) Clear authentication data and scan QR code again.`;
        
        reject(new Error(errorMsg));
      }, timeout);

      const cleanup = () => {
        clearTimeout(timer);
        if (stateCheckInterval) {
          clearInterval(stateCheckInterval);
        }
        this.removeAllListeners('ready');
        this.removeAllListeners('disconnected');
      };

      // Set up state polling fallback mechanism
      // Baileys doesn't get stuck like wwebjs, but keep for compatibility
      stateCheckInterval = setInterval(async () => {
        try {
          // Only check state if authenticated but not ready yet
          if (this.authenticated && !this.isReady) {
            const state = await this.getState();
            console.log(`[${this.config.clientId}] State check: ${state}`);
            
            // If state is CONNECTED, mark as ready
            if (state === 'CONNECTED') {
              console.log(`[${this.config.clientId}] Client is ready via state check (fallback mechanism)`);
              this.isReady = true;
              this.isInitializing = false;
              cleanup();
              this.emit('ready');
              resolve(true);
            }
          }
        } catch (error) {
          // Silently ignore state check errors
          if (error && error.message && !error.message.includes('not initialized')) {
            console.warn(`[${this.config.clientId}] Unexpected error during state check:`, error.message);
          }
        }
      }, 5000); // Check every 5 seconds

      this.once('ready', () => {
        cleanup();
        resolve(true);
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
