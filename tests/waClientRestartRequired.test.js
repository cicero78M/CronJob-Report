/**
 * Test: WhatsApp Client RESTART_REQUIRED Disconnect Handling
 * 
 * Verifies that the WAClient properly handles RESTART_REQUIRED disconnects
 * during the waitForReady phase by allowing reconnection instead of failing.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

describe('WAClient RESTART_REQUIRED disconnect handling', () => {
  let WAClient;
  let mockSocket;
  let mockAuthState;
  let mockSaveCreds;

  beforeEach(async () => {
    jest.resetModules();
    
    // Mock the Baileys library
    mockSocket = new EventEmitter();
    mockSocket.ev = new EventEmitter(); // Add ev property for Baileys events
    mockSocket.sendMessage = jest.fn().mockResolvedValue({ key: { id: 'test-msg-id' } });
    mockSocket.end = jest.fn();
    mockSocket.ws = {
      readyState: 1 // WebSocket.OPEN
    };
    mockSocket.user = {
      id: 'test-user-id',
      name: 'Test User'
    };
    mockSocket.onWhatsApp = jest.fn().mockResolvedValue([{ exists: true }]);
    
    mockAuthState = { creds: {}, keys: {} };
    mockSaveCreds = jest.fn();
    
    jest.unstable_mockModule('@whiskeysockets/baileys', () => ({
      __esModule: true,
      default: jest.fn(() => mockSocket),
      useMultiFileAuthState: jest.fn().mockResolvedValue({
        state: mockAuthState,
        saveCreds: mockSaveCreds
      }),
      DisconnectReason: {
        loggedOut: 401,
        forbidden: 403,
        multideviceMismatch: 411,
        connectionClosed: 428,
        connectionLost: 408,
        timedOut: 408,
        connectionReplaced: 440,
        badSession: 500,
        restartRequired: 515, // This is the one we're testing
        unavailableService: 503
      },
      Browsers: {
        ubuntu: jest.fn(() => ['Ubuntu', 'Chrome', '20.0.04'])
      },
      fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0] })
    }));
    
    // Mock pino logger
    jest.unstable_mockModule('pino', () => ({
      __esModule: true,
      default: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      }))
    }));
    
    // Mock qrcode-terminal
    jest.unstable_mockModule('qrcode-terminal', () => ({
      __esModule: true,
      default: {
        generate: jest.fn()
      }
    }));
    
    // Import WAClient after mocks are set up
    const waClientModule = await import('../src/wa/WAClient.js');
    WAClient = waClientModule.WAClient;
  });

  test('waitForReady should not reject on RESTART_REQUIRED disconnect', async () => {
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      qrTimeout: 5000 // Short timeout for testing
    });
    
    // Initialize the client
    await client.initialize();
    
    // Start waitForReady
    const readyPromise = client.waitForReady(10000); // 10 second timeout
    
    // Wait a bit for the promise to set up listeners
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simulate RESTART_REQUIRED disconnect
    const DisconnectReason = (await import('@whiskeysockets/baileys')).DisconnectReason;
    client.emit('disconnected', 'RESTART_REQUIRED');
    
    // The promise should NOT reject immediately for RESTART_REQUIRED
    // Instead, it should wait for reconnection
    
    // Simulate successful reconnection after a delay
    setTimeout(() => {
      client.isReady = true;
      client.authenticated = true;
      client.emit('ready');
    }, 500);
    
    // The promise should resolve after reconnection
    await expect(readyPromise).resolves.toBe(true);
  });

  test('waitForReady should reject on terminal disconnect (LOGGED_OUT)', async () => {
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      qrTimeout: 5000
    });
    
    // Initialize the client
    await client.initialize();
    
    // Start waitForReady
    const readyPromise = client.waitForReady(10000);
    
    // Wait a bit for the promise to set up listeners
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simulate LOGGED_OUT disconnect (terminal)
    client.emit('disconnected', 'LOGGED_OUT');
    
    // The promise should reject immediately for terminal disconnects
    await expect(readyPromise).rejects.toThrow('Disconnected while waiting for ready: LOGGED_OUT');
  });

  test('waitForReady should handle multiple reconnectable disconnects', async () => {
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      qrTimeout: 5000
    });
    
    // Initialize the client
    await client.initialize();
    
    // Start waitForReady
    const readyPromise = client.waitForReady(15000); // 15 second timeout
    
    // Wait a bit for the promise to set up listeners
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simulate first RESTART_REQUIRED disconnect
    client.emit('disconnected', 'RESTART_REQUIRED');
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Simulate second CONNECTION_LOST disconnect
    client.emit('disconnected', 'CONNECTION_LOST');
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Simulate third TIMED_OUT disconnect
    client.emit('disconnected', 'TIMED_OUT');
    
    // Finally emit ready
    setTimeout(() => {
      client.isReady = true;
      client.authenticated = true;
      client.emit('ready');
    }, 500);
    
    // The promise should resolve after reconnection despite multiple disconnects
    await expect(readyPromise).resolves.toBe(true);
  });

  test('waitForReady should reject if terminal disconnect occurs after reconnectable disconnects', async () => {
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      qrTimeout: 5000
    });
    
    // Initialize the client
    await client.initialize();
    
    // Start waitForReady
    const readyPromise = client.waitForReady(10000);
    
    // Wait a bit for the promise to set up listeners
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Simulate reconnectable disconnect first
    client.emit('disconnected', 'RESTART_REQUIRED');
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Then simulate terminal disconnect
    client.emit('disconnected', 'BAD_SESSION');
    
    // The promise should reject on terminal disconnect
    await expect(readyPromise).rejects.toThrow('Disconnected while waiting for ready: BAD_SESSION');
  });

  test('all terminal disconnect reasons should reject waitForReady', async () => {
    const terminalReasons = [
      'LOGGED_OUT',
      'UNPAIRED',
      'FORBIDDEN',
      'MULTIDEVICE_MISMATCH',
      'CONNECTION_REPLACED',
      'BAD_SESSION'
    ];

    for (const reason of terminalReasons) {
      const client = new WAClient({
        clientId: `test-client-${reason}`,
        authPath: '/tmp/test-auth',
        qrTimeout: 5000
      });
      
      // Initialize the client
      await client.initialize();
      
      // Start waitForReady
      const readyPromise = client.waitForReady(5000);
      
      // Wait a bit for the promise to set up listeners
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Simulate terminal disconnect
      client.emit('disconnected', reason);
      
      // The promise should reject
      await expect(readyPromise).rejects.toThrow(`Disconnected while waiting for ready: ${reason}`);
    }
  });

  test('reconnectable disconnect reasons should not reject waitForReady', async () => {
    const reconnectableReasons = [
      'RESTART_REQUIRED',
      'CONNECTION_CLOSED',
      'CONNECTION_LOST',
      'TIMED_OUT',
      'UNAVAILABLE_SERVICE',
      'UNKNOWN'
    ];

    for (const reason of reconnectableReasons) {
      const client = new WAClient({
        clientId: `test-client-${reason}`,
        authPath: '/tmp/test-auth',
        qrTimeout: 5000
      });
      
      // Initialize the client
      await client.initialize();
      
      // Start waitForReady
      const readyPromise = client.waitForReady(3000);
      
      // Wait a bit for the promise to set up listeners
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Simulate reconnectable disconnect
      client.emit('disconnected', reason);
      
      // Wait a bit to ensure no immediate rejection
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Emit ready to complete the test
      setTimeout(() => {
        client.isReady = true;
        client.authenticated = true;
        client.emit('ready');
      }, 100);
      
      // The promise should resolve (not reject)
      await expect(readyPromise).resolves.toBe(true);
    }
  });
});
