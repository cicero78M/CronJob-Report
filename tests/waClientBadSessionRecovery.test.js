/**
 * Test: WhatsApp Client BAD_SESSION Recovery
 * 
 * Verifies that the WAClient properly handles BAD_SESSION disconnects
 * by automatically clearing the corrupted session and reinitializing.
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

  test('should automatically recover from BAD_SESSION by clearing session and reinitializing', async () => {
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
    
    // Mock _clearAuthSession
    const clearAuthSpy = jest.spyOn(client, '_clearAuthSession');
    clearAuthSpy.mockResolvedValue();
    
    // Trigger BAD_SESSION recovery directly
    await client._handleBadSessionRecovery();
    
    // Fast-forward time to trigger reinit
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();
    
    // Verify session cleanup was called
    expect(clearAuthSpy).toHaveBeenCalled();
    
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

  test('should handle session cleanup error gracefully', async () => {
    const client = new WAClient({
      clientId: 'test-client',
      authPath: '/tmp/test-auth',
      qrTimeout: 5000,
      enableBadSessionRecovery: true
    });
    
    // Mock _clearAuthSession to fail
    const clearAuthSpy = jest.spyOn(client, '_clearAuthSession');
    clearAuthSpy.mockRejectedValue(new Error('Permission denied'));
    
    // Set up event listener
    const recoveryFailedHandler = jest.fn();
    client.on('bad_session_recovery_failed', recoveryFailedHandler);
    
    // Trigger BAD_SESSION recovery
    await client._handleBadSessionRecovery();
    
    // Wait for recovery attempt
    await Promise.resolve();
    await Promise.resolve();
    
    // Verify cleanup was attempted
    expect(clearAuthSpy).toHaveBeenCalled();
    
    // Verify recovery failed event was emitted
    expect(recoveryFailedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Permission denied'
      })
    );
  }, 10000);
});
