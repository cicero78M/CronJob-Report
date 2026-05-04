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
import fs from 'fs/promises';

// Constants
const MAX_ERROR_MESSAGE_LENGTH = 100; // Maximum length for truncated error messages in logs

/**
 * Custom error class for WhatsApp operations
 * Helps identify whether errors are retriable or permanent
 */
class WAError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'WAError';
    // Require explicit specification for safety
    // If not specified, default to retriable to maintain backward compatibility
    // but log a warning for developers
    if (options.isRetriable === undefined) {
      console.warn(`[WAError] isRetriable not specified for error: ${message}. Defaulting to retriable.`);
      this.isRetriable = true;
    } else {
      this.isRetriable = options.isRetriable;
    }
    this.statusCode = options.statusCode;
    this.originalError = options.originalError;
  }
}

/**
 * Safely truncate a string to a maximum length, adding ellipsis if truncated
 * Handles unicode characters properly to avoid cutting in the middle of multi-byte chars
 */
function truncateString(str, maxLength) {
  if (!str || str.length <= maxLength) {
    return str;
  }
  // Use substring which is safe with unicode, then add ellipsis
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Configuration class for WhatsApp client
 * Following camelCase naming convention for class properties
 */
class WAClientConfig {
  constructor(options = {}) {
    this.clientId = options.clientId || 'wa-direktorat';
    this.authPath = options.authPath || path.join(os.homedir(), '.cicero', 'baileys_auth');
    // Parse as integers to handle environment variables passed as strings
    this.maxInitRetries = parseInt(options.maxInitRetries, 10) || 3;
    this.initRetryDelay = parseInt(options.initRetryDelay, 10) || 10000; // 10 seconds
    this.qrTimeout = parseInt(options.qrTimeout, 10) || 120000; // 2 minutes for QR scan
    this.logLevel = options.logLevel || 'error'; // Baileys logging level
    // Option to suppress non-critical Baileys session errors (Bad MAC, SessionError)
    this.suppressSessionErrors = options.suppressSessionErrors !== false; // default true
    // Option to enable automatic recovery from BAD_SESSION errors
    // When enabled, the client will clear the session and attempt to reinitialize
    this.enableBadSessionRecovery = options.enableBadSessionRecovery !== false; // default true
    // Option to enable automatic recovery from LOGGED_OUT errors
    // When enabled, the client will clear the session and reinitialize for fresh QR pairing
    this.enableLoggedOutRecovery = options.enableLoggedOutRecovery !== false; // default true
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
    // Message store for decryption - keeps last 100 messages per chat
    this.messageStore = new Map();
    this.maxMessagesPerChat = 100;
    // Message retry counter cache to track failed decryption attempts
    // Key format: "remoteJid:messageId" -> retry count
    this.msgRetryCounterCache = new Map();
    this.maxMsgRetryCount = 5; // Max retries before giving up on a message
    // Session error tracking to detect persistent issues
    this.sessionErrorCount = 0;
    this.firstSessionErrorTime = null;
    this.lastSessionErrorTime = null;
    this.sessionErrorThreshold = 10; // Trigger cleanup after this many errors in a short time
    this.sessionErrorWindowMs = 60000; // 1 minute window for error tracking
  }

  /**
   * Log QR code in a PM2-friendly way.
   * qrcode-terminal writes directly to stdout and can be swallowed in some PM2 setups.
   */
  _logQrCode(qr) {
    qrcode.generate(qr, { small: true }, (qrAscii) => {
      console.log(`[${this.config.clientId}] QR_CODE_START`);
      qrAscii.split('\n').forEach((line) => {
        console.log(`[${this.config.clientId}] ${line}`);
      });
      console.log(`[${this.config.clientId}] QR_CODE_END`);
    });
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
          this.socket.end();
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

      // Create logger for Baileys
      // If suppressSessionErrors is enabled, elevate log level to suppress non-critical errors
      // Bad MAC and SessionError messages are often transient and handled by Baileys internally
      // Only applies when logLevel would show errors (error, warn, info, debug, trace)
      let baileysLogLevel = this.config.logLevel;
      if (this.config.suppressSessionErrors) {
        // Map levels that would show errors to 'fatal' to suppress them
        const errorShowingLevels = ['error', 'warn', 'info', 'debug', 'trace'];
        if (errorShowingLevels.includes(this.config.logLevel)) {
          baileysLogLevel = 'fatal';
        }
      }
      
      const baileysLogger = pino({ level: baileysLogLevel });

      // Create Baileys socket with configuration
      this.socket = makeWASocket({
        auth: this.authState,
        browser: Browsers.ubuntu('Chrome'),
        logger: baileysLogger,
        printQRInTerminal: false, // We handle QR display manually
        shouldSyncHistoryMessage: () => false, // Don't sync message history
        version: version,
        // Handle decryption retries - reduces "Bad MAC" errors
        retryRequestDelayMs: 350, // Slightly longer delay between retries
        maxMsgRetryCount: this.maxMsgRetryCount, // Max retry count for failed messages
        // Provide retry counter cache to track message retry attempts
        msgRetryCounterCache: {
          get: async (key) => {
            const cacheKey = `${key.remoteJid}:${key.id}`;
            return this.msgRetryCounterCache.get(cacheKey) || 0;
          },
          set: async (key, value) => {
            const cacheKey = `${key.remoteJid}:${key.id}`;
            this.msgRetryCounterCache.set(cacheKey, value);
            // Clean up old entries to prevent memory leak (keep max 1000 entries)
            // Remove oldest 10% when limit is reached to avoid frequent cleanup
            if (this.msgRetryCounterCache.size > 1000) {
              const entriesToRemove = Math.floor(this.msgRetryCounterCache.size * 0.1);
              const keys = Array.from(this.msgRetryCounterCache.keys()).slice(0, entriesToRemove);
              for (const k of keys) {
                this.msgRetryCounterCache.delete(k);
              }
            }
          }
        },
        getMessage: async (key) => {
          // Retrieve message from store for decryption purposes
          // This is needed for message references (replies, reactions, etc.)
          if (!key || !key.remoteJid || !key.id) {
            return undefined;
          }
          
          const chatMessages = this.messageStore.get(key.remoteJid);
          if (!chatMessages) {
            return undefined;
          }
          
          // Find message by ID
          const message = chatMessages.get(key.id);
          return message;
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
        this._logQrCode(qr);
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
        
        // Special handling for BAD_SESSION with recovery enabled
        if (reason === 'BAD_SESSION' && this.config.enableBadSessionRecovery) {
          console.log(`[${this.config.clientId}] BAD_SESSION detected - attempting automatic recovery`);
          this._handleBadSessionRecovery();
        } else if (reason === 'LOGGED_OUT' && this.config.enableLoggedOutRecovery) {
          console.log(`[${this.config.clientId}] LOGGED_OUT detected - attempting automatic recovery`);
          this._handleLoggedOutRecovery();
        } else if (shouldReconnect) {
          // Attempt to reconnect for retriable disconnect reasons
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
        try {
          // Store message for future decryption needs
          this._storeMessage(msg);
          
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
        } catch (error) {
          // Handle decryption errors gracefully
          // These can occur due to session issues, bad MAC, or missing session keys
          
          // Safely extract error information
          let errorName = 'Unknown';
          let errorMsg = 'Unknown error';
          
          if (error instanceof Error) {
            errorName = error.name;
            errorMsg = error.message;
          } else if (error && typeof error === 'object') {
            // Handle non-Error objects (e.g., thrown strings or objects)
            errorName = error.constructor?.name || 'Object';
            errorMsg = error.message || error.toString?.() || String(error);
          } else {
            // Handle primitives
            errorMsg = String(error);
          }
          
          // Log session-related errors at info level (they're expected in some cases)
          if (errorName === 'SessionError' || errorMsg.includes('Bad MAC') || errorMsg.includes('session')) {
            console.info(`[${this.config.clientId}] Message decryption issue (${errorName}): ${truncateString(errorMsg, MAX_ERROR_MESSAGE_LENGTH)}`);
            
            // Track session errors to detect persistent issues
            this._trackSessionError();
          } else {
            // Log other errors as warnings
            console.warn(`[${this.config.clientId}] Error processing message:`, errorName, truncateString(errorMsg, MAX_ERROR_MESSAGE_LENGTH));
          }
          
          // Don't propagate the error - continue processing other messages
          // The message will be skipped but app continues running
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

    // Handle messaging history sync events
    // This is important for managing session state during history sync
    this.socket.ev.on('messaging-history.set', ({ chats, messages, isLatest }) => {
      try {
        console.log(`[${this.config.clientId}] Messaging history sync: ${messages.length} messages, ${chats.length} chats, isLatest: ${isLatest}`);
        
        // When history sync completes, it's a good time to clean up retry counters
        // as the session state is now fresh
        if (isLatest) {
          console.log(`[${this.config.clientId}] History sync complete - cleaning up retry counters`);
          this.msgRetryCounterCache.clear();
          // Reset session error tracking as we have a fresh sync
          this.sessionErrorCount = 0;
          this.firstSessionErrorTime = null;
          this.lastSessionErrorTime = null;
        }
        
        // Store synced messages in our message store for future decryption needs
        for (const msg of messages) {
          this._storeMessage(msg);
        }
      } catch (error) {
        console.warn(`[${this.config.clientId}] Error handling messaging history:`, error.message);
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
   * Track session errors to detect persistent issues
   * If too many session errors occur in a short time window, trigger cleanup
   */
  _trackSessionError() {
    const now = Date.now();
    
    // Track first error time for accurate window calculation
    if (!this.lastSessionErrorTime) {
      this.firstSessionErrorTime = now;
    }
    
    // Reset counter if we're outside the error tracking window
    if (this.lastSessionErrorTime && (now - this.lastSessionErrorTime) > this.sessionErrorWindowMs) {
      this.sessionErrorCount = 0;
      this.firstSessionErrorTime = now;
    }
    
    this.sessionErrorCount++;
    this.lastSessionErrorTime = now;
    
    // If we've hit the threshold, trigger session cleanup
    if (this.sessionErrorCount >= this.sessionErrorThreshold) {
      const actualWindowMs = now - (this.firstSessionErrorTime || now);
      console.warn(`[${this.config.clientId}] High session error rate detected (${this.sessionErrorCount} errors in ${actualWindowMs}ms) - triggering cleanup`);
      
      // Clear retry counters to allow fresh retry attempts
      this.msgRetryCounterCache.clear();
      
      // Reset the error counter after cleanup
      this.sessionErrorCount = 0;
      this.firstSessionErrorTime = null;
      this.lastSessionErrorTime = null;
      
      // If automatic recovery is enabled and errors persist, trigger bad session recovery
      if (this.config.enableBadSessionRecovery) {
        console.log(`[${this.config.clientId}] Persistent session errors - considering session recovery`);
        // Don't immediately trigger recovery, just log it for now
        // The connection.update handler will handle actual BAD_SESSION disconnects
      }
    }
  }

  /**
   * Store message in memory for decryption purposes
   * Keeps a limited cache of recent messages per chat
   */
  _storeMessage(baileyMsg) {
    if (!baileyMsg || !baileyMsg.key || !baileyMsg.key.remoteJid || !baileyMsg.key.id) {
      return;
    }

    const chatJid = baileyMsg.key.remoteJid;
    const messageId = baileyMsg.key.id;

    // Get or create chat message store
    let chatMessages = this.messageStore.get(chatJid);
    if (!chatMessages) {
      chatMessages = new Map();
      this.messageStore.set(chatJid, chatMessages);
    }

    // Store the message content (proto.IMessage format expected by Baileys)
    // baileyMsg.message contains the actual message payload (text, media, etc.)
    // This is what getMessage should return according to Baileys documentation
    if (baileyMsg.message) {
      chatMessages.set(messageId, baileyMsg.message);

      // Limit cache size per chat to prevent memory growth
      // Logic: After insertion, check if we exceeded the limit
      // Example with max=100: had 100 → insert → now 101 → 101>100 true → delete oldest → back to 100
      // This maintains exactly maxMessagesPerChat items in the cache
      // Note: Map maintains insertion order, so first key is oldest
      if (chatMessages.size > this.maxMessagesPerChat) {
        // Remove oldest message (first inserted)
        const firstKey = chatMessages.keys().next().value;
        chatMessages.delete(firstKey);
      }
    }
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
   * Handle BAD_SESSION recovery
   * Clears the corrupted session and attempts to reinitialize
   */
  async _handleBadSessionRecovery() {
    try {
      console.log(`[${this.config.clientId}] Starting BAD_SESSION recovery process`);
      
      // First, clean up the current connection
      if (this.socket) {
        try {
          this.socket.end();
          this.socket = null;
        } catch (err) {
          console.warn(`[${this.config.clientId}] Error closing socket during recovery:`, err);
        }
      }
      
      // Clear the corrupted auth session
      await this._clearAuthSession();
      
      // Reset initialization state
      this.isReady = false;
      this.isInitializing = false;
      this.authenticated = false;
      this.qrScanned = false;
      this.reconnectAttempts = 0;
      this.initRetries = 0;
      
      // Wait a bit before reinitializing to avoid immediate reconnect
      const delay = 5000; // 5 seconds
      console.log(`[${this.config.clientId}] Will reinitialize with cleared session in ${delay}ms`);
      
      this.reconnectTimer = setTimeout(async () => {
        try {
          console.log(`[${this.config.clientId}] Reinitializing after BAD_SESSION recovery`);
          await this.initialize();
          console.log(`[${this.config.clientId}] BAD_SESSION recovery completed - please scan QR code if prompted`);
        } catch (error) {
          console.error(`[${this.config.clientId}] BAD_SESSION recovery failed:`, error);
          this.emit('bad_session_recovery_failed', error);
        }
      }, delay);
    } catch (error) {
      console.error(`[${this.config.clientId}] Error during BAD_SESSION recovery:`, error);
      this.emit('bad_session_recovery_failed', error);
    }
  }

  /**
   * Handle LOGGED_OUT recovery
   * Clears the auth session and reinitializes so the operator can re-scan QR
   */
  async _handleLoggedOutRecovery() {
    try {
      console.log(`[${this.config.clientId}] Starting LOGGED_OUT recovery process`);

      if (this.socket) {
        try {
          this.socket.end();
          this.socket = null;
        } catch (err) {
          console.warn(`[${this.config.clientId}] Error closing socket during LOGGED_OUT recovery:`, err);
        }
      }

      await this._clearAuthSession();

      this.isReady = false;
      this.isInitializing = false;
      this.authenticated = false;
      this.qrScanned = false;
      this.reconnectAttempts = 0;
      this.initRetries = 0;

      const delay = 5000;
      console.log(`[${this.config.clientId}] Will reinitialize after LOGGED_OUT in ${delay}ms`);

      this.reconnectTimer = setTimeout(async () => {
        try {
          console.log(`[${this.config.clientId}] Reinitializing after LOGGED_OUT recovery`);
          await this.initialize();
          console.log(`[${this.config.clientId}] LOGGED_OUT recovery completed - please scan QR code if prompted`);
        } catch (error) {
          console.error(`[${this.config.clientId}] LOGGED_OUT recovery failed:`, error);
          this.emit('logged_out_recovery_failed', error);
        }
      }, delay);
    } catch (error) {
      console.error(`[${this.config.clientId}] Error during LOGGED_OUT recovery:`, error);
      this.emit('logged_out_recovery_failed', error);
    }
  }

  /**
   * Handle initialization timeout
   */
  async _handleInitializationTimeout(reason) {
    console.warn(`[${this.config.clientId}] Initialization timeout: ${reason}`);
    this.isInitializing = false;
    
    try {
      if (this.socket) {
        this.socket.end();
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

      // For group messages, validate access first to avoid 403 errors
      const isGroupJid = normalizedJid.endsWith('@g.us');
      if (isGroupJid) {
        try {
          // Attempt to fetch group metadata to verify we have access
          await this.socket.groupMetadata(normalizedJid);
        } catch (metadataError) {
          // Handle group access errors
          const statusCode = metadataError?.output?.statusCode || metadataError?.data;
          if (statusCode === 403 || metadataError?.message?.includes('forbidden')) {
            // 403 Forbidden - bot doesn't have access or was removed from group
            const errorMsg = `Cannot send message to group ${normalizedJid}: Bot lacks permission or was removed from group`;
            console.warn(`[${this.config.clientId}] ${errorMsg}`);
            throw new WAError(errorMsg, {
              isRetriable: false,
              statusCode: 403,
              originalError: metadataError
            });
          }
          // For other metadata errors, log but continue attempt to send
          console.warn(`[${this.config.clientId}] Warning: Could not verify group access for ${normalizedJid}:`, metadataError.message);
        }
      }

      // Send message using Baileys socket
      const result = await this.socket.sendMessage(normalizedJid, message, {
        quoted: normalizedOptions.quoted,
        ...normalizedOptions
      });
      
      return result;
    } catch (error) {
      // Classify the error for retry handling
      const statusCode = error?.output?.statusCode || error?.data;
      const errorMessage = error?.message || String(error);
      
      // Check if this is already a WAError (from group validation above)
      if (error instanceof WAError) {
        console.error(`[${this.config.clientId}] Error sending message to ${to}:`, error.message);
        throw error;
      }
      
      // Classify non-retriable errors
      const nonRetriableConditions = [
        statusCode === 403,
        statusCode === 401,
        errorMessage.toLowerCase().includes('forbidden'),
        errorMessage.toLowerCase().includes('not authorized'),
        errorMessage.toLowerCase().includes('participant')
      ];
      
      const isRetriable = !nonRetriableConditions.some(condition => condition);
      
      // Create classified error
      const waError = new WAError(
        `Failed to send message to ${to}: ${truncateString(errorMessage, MAX_ERROR_MESSAGE_LENGTH)}`,
        {
          isRetriable,
          statusCode,
          originalError: error
        }
      );
      
      console.error(`[${this.config.clientId}] Error sending message to ${to}:`, waError.message, `(retriable: ${isRetriable})`);
      throw waError;
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
    
    // Clear message store to free memory
    if (this.messageStore) {
      this.messageStore.clear();
    }
    
    // Clear retry counter cache
    if (this.msgRetryCounterCache) {
      this.msgRetryCounterCache.clear();
    }
    
    // Reset session error tracking
    this.sessionErrorCount = 0;
    this.firstSessionErrorTime = null;
    this.lastSessionErrorTime = null;
    
    if (this.socket) {
      try {
        this.socket.end(); // Graceful close
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
   * Clear authentication session folder
   * Used for BAD_SESSION recovery - removes corrupted auth state
   */
  async _clearAuthSession() {
    const sessionPath = path.join(this.config.authPath, `session-${this.config.clientId}`);
    
    try {
      console.log(`[${this.config.clientId}] Clearing auth session at: ${sessionPath}`);
      
      // Check if session exists
      try {
        await fs.access(sessionPath);
      } catch {
        // Session folder doesn't exist
        console.log(`[${this.config.clientId}] Session folder does not exist, nothing to clear`);
        return;
      }
      
      // Remove the session folder recursively
      await fs.rm(sessionPath, { recursive: true, force: true });
      console.log(`[${this.config.clientId}] Auth session cleared successfully`);
    } catch (error) {
      console.error(`[${this.config.clientId}] Failed to clear auth session:`, error);
      throw error;
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
        
        // Build concise error message
        let reason = 'timeout';
        if (!this.authenticated && !this.qrScanned) {
          reason = 'QR code not scanned';
        } else if (this.authenticated && !this.isReady) {
          reason = 'authenticated but not ready';
        } else if (this.lastError) {
          const errorMsg = typeof this.lastError === 'string' 
            ? this.lastError 
            : this.lastError.message;
          reason = errorMsg?.trim() || 'initialization error';
        }
        
        const errorMsg = `[${this.config.clientId}] Timeout after ${elapsed}ms (state: ${state}, reason: ${reason})`;
        
        // Create error with detailed diagnostics as properties (not in message)
        const error = new Error(errorMsg);
        error.timeout = elapsed;
        error.state = state;
        error.authenticated = this.authenticated;
        error.qrScanned = this.qrScanned;
        error.lastError = this.lastError;
        error.authPath = this.config.authPath;
        
        reject(error);
      }, timeout);

      // Handler for ready event
      const onReady = () => {
        cleanup();
        resolve(true);
      };

      // Handler for disconnection during wait
      // Only reject for terminal disconnects - allow reconnectable disconnects to retry
      const onDisconnected = (reason) => {
        // Terminal disconnect reasons that should not be retried
        const terminalReasons = [
          'LOGGED_OUT',
          'UNPAIRED',
          'FORBIDDEN',
          'MULTIDEVICE_MISMATCH',
          'CONNECTION_REPLACED',
          'BAD_SESSION'
        ];
        
        if (terminalReasons.includes(reason)) {
          console.error(`[${this.config.clientId}] Terminal disconnect: ${reason}`);
          cleanup();
          reject(new Error(`[${this.config.clientId}] Disconnected while waiting for ready (terminal): ${reason}`));
        } else {
          // Reconnectable disconnect - log but continue waiting for ready event
          console.warn(`[${this.config.clientId}] Reconnectable disconnect during waitForReady: ${reason}, waiting for reconnection...`);
          // Don't cleanup or reject - the client will attempt reconnection
          // and emit 'ready' event when successful
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        if (stateCheckInterval) {
          clearInterval(stateCheckInterval);
        }
        this.removeListener('ready', onReady);
        this.removeListener('disconnected', onDisconnected);
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
      
      this.once('ready', onReady);
      
      // Use on() instead of once() for disconnect to handle multiple reconnectable disconnects
      this.on('disconnected', onDisconnected);
    });
  }
}

// Export WAError for use in other modules
export { WAError };

export default WAClient;
