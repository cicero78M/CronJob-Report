/**
 * Test: WhatsApp Client BAD_SESSION Recovery
 * 
 * Verifies that the WAClient properly handles BAD_SESSION disconnects
 * by preserving authentication state and reinitializing with backoff.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

describe('WAClient BAD_SESSION recovery', () => {
  let WAClient;
  let mockSocket;
  let mockAuthState;
  let mockSaveCreds;
  let mockFs;

  beforeEach(async () => {
    jest.resetModules();
    
    // Mock fs/promises
    mockFs = {
      access: jest.fn().mockResolvedValue(undefined),
      rm: jest.fn().mockResolvedValue(undefined)
    };
    
    jest.unstable_mockModule('fs/promises', () => ({
      default: mockFs,
      ...mockFs
    }));
    
    // Mock the Baileys library
    mockSocket = new EventEmitter();
    mockSocket.ev = new EventEmitter();
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
        badSession: 500,
        restartRequired: 515,
        connectionClosed: 428,
        connectionLost: 408
      },
      Browsers: {
        ubuntu: () => ['Ubuntu', '20.04', '1.0']
      },
      fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: '1.0.0' })
    }));
    
    // Mock pino logger
    jest.unstable_mockModule('pino', () => ({
      default: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
      }))
    }));
    
    // Mock qrcode-terminal
    jest.unstable_mockModule('qrcode-terminal', () => ({
      default: {
        generate: jest.fn()
      }
    }));
    
    // Import WAClient after mocking
    const waClientModule = await import('../src/wa/WAClient.js');
    WAClient = waClientModule.WAClient;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  test('should automatically recover from BAD_SESSION without clearing auth', async () => {
    jest.useFakeTimers();
    
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      qrTimeout: 5000,
      enableBadSessionRecovery: true
    });
    
    // Mock initialize to succeed
    const initializeSpy = jest.spyOn(client, 'initialize');
    initializeSpy.mockResolvedValue();
    
    // Auth reset must never be part of automatic BAD_SESSION recovery.
    const clearAuthSpy = jest.spyOn(client, '_clearAuthSession');
    clearAuthSpy.mockResolvedValue();
    
    // Trigger BAD_SESSION recovery directly
    await client._handleBadSessionRecovery();
    
    // Fast-forward time to trigger reinit
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();
    
    expect(clearAuthSpy).not.toHaveBeenCalled();
    
    // Verify reinitialization was attempted
    expect(initializeSpy).toHaveBeenCalled();
    
    jest.useRealTimers();
  }, 10000);

  test('should not recover from BAD_SESSION when recovery is disabled', async () => {
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      qrTimeout: 5000,
      enableBadSessionRecovery: false
    });
    
    // Mock initialize to succeed
    const initializeSpy = jest.spyOn(client, 'initialize');
    initializeSpy.mockResolvedValue();
    
    // Trigger initialization
    await client.initialize();
    
    // Simulate connection open
    mockSocket.ev.emit('connection.update', {
      connection: 'open'
    });
    
    // Simulate BAD_SESSION disconnect
    mockSocket.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: {
        error: {
          output: {
            statusCode: 500
          }
        }
      }
    });
    
    // Wait for any async operations
    await Promise.resolve();
    
    // Verify session cleanup was NOT called
    expect(mockFs.rm).not.toHaveBeenCalled();
    
    // Verify reinitialization was NOT attempted
    expect(initializeSpy).toHaveBeenCalledTimes(1); // Only initial call
  });

  test('should emit bad_session_recovery_failed event on recovery error', async () => {
    jest.useFakeTimers();
    
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      qrTimeout: 5000,
      enableBadSessionRecovery: true
    });
    
    // Mock initialize to fail
    const initializeSpy = jest.spyOn(client, 'initialize');
    initializeSpy.mockRejectedValue(new Error('Reinit failed'));
    
    // Mock _clearAuthSession to succeed
    const clearAuthSpy = jest.spyOn(client, '_clearAuthSession');
    clearAuthSpy.mockResolvedValue();
    
    // Set up event listener
    const recoveryFailedHandler = jest.fn();
    client.on('bad_session_recovery_failed', recoveryFailedHandler);
    
    // Trigger BAD_SESSION recovery
    await client._handleBadSessionRecovery();
    
    // Fast-forward time to trigger recovery
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();
    
    // Verify recovery failed event was emitted
    expect(recoveryFailedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Reinit failed'
      })
    );
    
    jest.useRealTimers();
  }, 10000);

  test('should stop after bounded retries while preserving auth', async () => {
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      qrTimeout: 5000,
      enableBadSessionRecovery: true
    });
    
    client.reconnectAttempts = client.maxReconnectAttempts;
    const clearAuthSpy = jest.spyOn(client, '_clearAuthSession');
    const recoveryFailedHandler = jest.fn();
    client.on('bad_session_recovery_failed', recoveryFailedHandler);
    
    // Trigger BAD_SESSION recovery
    await client._handleBadSessionRecovery();
    
    // Wait for recovery attempt
    await Promise.resolve();
    await Promise.resolve();
    
    expect(clearAuthSpy).not.toHaveBeenCalled();
    expect(recoveryFailedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('auth was preserved')
      })
    );
  }, 10000);

  test('should ignore duplicate recovery while one recovery is in-flight', async () => {
    jest.useFakeTimers();
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      enableBadSessionRecovery: true
    });
    const clearAuthSpy = jest.spyOn(client, '_clearAuthSession').mockResolvedValue();
    jest.spyOn(client, 'initialize').mockResolvedValue();

    await Promise.all([
      client._handleBadSessionRecovery(),
      client._handleBadSessionRecovery()
    ]);

    expect(clearAuthSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    jest.useRealTimers();
  });

  test('should preserve an unregistered pairing session after LOGGED_OUT', async () => {
    jest.useFakeTimers();
    const client = new WAClient({ clientId: 'test-client', authPath: '/tmp/test-auth' });
    client.authState = { creds: { registered: false } };
    const clearAuthSpy = jest.spyOn(client, '_clearAuthSession').mockResolvedValue();
    jest.spyOn(client, 'initialize').mockResolvedValue();

    await client._handleLoggedOutRecovery();

    expect(clearAuthSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    jest.useRealTimers();
  });

  test('should clear a confirmed registered session after LOGGED_OUT', async () => {
    jest.useFakeTimers();
    const client = new WAClient({ clientId: 'test-client', authPath: '/tmp/test-auth' });
    client.authState = { creds: { registered: true } };
    const clearAuthSpy = jest.spyOn(client, '_clearAuthSession').mockResolvedValue();
    jest.spyOn(client, 'initialize').mockResolvedValue();

    await client._handleLoggedOutRecovery();

    expect(clearAuthSpy).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    jest.useRealTimers();
  });
});
