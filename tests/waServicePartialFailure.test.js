/**
 * Test: WhatsApp Service Partial Failure Handling
 * 
 * Verifies that the WhatsApp service can handle scenarios where
 * one or more clients fail to initialize (e.g., LOGGED_OUT)
 * while allowing the application to continue with available clients.
 */

import { jest } from '@jest/globals';

describe('waService partial failure handling', () => {
  let waService;
  let initializeWAService;
  let waClient;
  let waGatewayClient;
  let mockWAClientReady;
  let mockWAGatewayFailed;
  
  beforeEach(async () => {
    // Reset modules before each test
    jest.resetModules();
    
    // Create mock for successful client (wa-client)
    mockWAClientReady = {
      initialize: jest.fn().mockResolvedValue(undefined),
      waitForReady: jest.fn().mockResolvedValue(true),
      isReady: true,
      on: jest.fn(),
    };
    
    // Create mock for failed client (wa-gateway with LOGGED_OUT error)
    mockWAGatewayFailed = {
      initialize: jest.fn().mockResolvedValue(undefined),
      waitForReady: jest.fn().mockRejectedValue(new Error('[wa-gateway] Disconnected while waiting for ready (terminal): LOGGED_OUT')),
      isReady: false,
      on: jest.fn(),
    };
    
    // Create mock service that returns different clients
    const mockWAService = {
      createClient: jest.fn((clientId) => {
        return clientId === 'wa-client' ? mockWAClientReady : mockWAGatewayFailed;
      }),
      initializeClient: jest.fn().mockResolvedValue(undefined),
      getClient: jest.fn((clientId) => {
        return clientId === 'wa-client' ? mockWAClientReady : mockWAGatewayFailed;
      }),
      waitForAllReady: jest.fn().mockResolvedValue([
        { clientId: 'wa-client', status: 'success', ready: true },
        { clientId: 'wa-gateway', status: 'failed', ready: false, error: '[wa-gateway] Disconnected while waiting for ready (terminal): LOGGED_OUT' }
      ]),
    };
    
    // Mock the WAService
    jest.unstable_mockModule('../src/wa/WAService.js', () => ({
      waService: mockWAService,
      WAService: jest.fn().mockImplementation(() => mockWAService),
    }));
    
    // Mock compatibility layer
    jest.unstable_mockModule('../src/wa/compatibility.js', () => ({
      WAClientCompat: class {
        constructor(clientId) {
          this.clientId = clientId;
          this._client = mockWAService.getClient(clientId);
          this.isReady = this._client?.isReady || false;
          this.sendMessage = jest.fn().mockImplementation(() => {
            if (!this.isReady) {
              return Promise.reject(new Error(`[WAClientCompat] Client ${this.clientId} is not ready. Please ensure the client is authenticated and connected.`));
            }
            return Promise.resolve(true);
          });
          this.waitForWaReady = jest.fn().mockImplementation(() => {
            return this._client?.waitForReady ? this._client.waitForReady() : Promise.resolve();
          });
        }
      },
      waService: mockWAService,
    }));
    
    // Mock WAHelpers
    jest.unstable_mockModule('../src/wa/WAHelpers.js', () => ({
      formatToWhatsAppId: jest.fn((id) => id),
      getAdminWAIds: jest.fn(() => []),
      isAdmin: jest.fn(() => false),
    }));
    
    // Mock env
    jest.unstable_mockModule('../src/config/env.js', () => ({
      env: {
        APP_SESSION_NAME: 'test-wa-admin',
        GATEWAY_WA_CLIENT_ID: 'test-wa-gateway',
        WA_AUTH_DATA_PATH: '/tmp/test-auth',
        WA_INIT_MAX_RETRIES: 3,
        WA_INIT_RETRY_DELAY_MS: 10000,
        WA_QR_TIMEOUT_MS: 120000,
      },
    }));
    
    // Import the actual module
    const waServiceModule = await import('../src/service/waService.js');
    initializeWAService = waServiceModule.initializeWAService;
    waClient = waServiceModule.waClient;
    waGatewayClient = waServiceModule.waGatewayClient;
  });

  test('initializeWAService should succeed when wa-client is ready but wa-gateway fails', async () => {
    // Initialize should not throw even though wa-gateway fails
    await expect(initializeWAService()).resolves.not.toThrow();
  });

  test('waClient should be usable when ready', async () => {
    await initializeWAService();
    
    // wa-client is ready and should work
    expect(waClient.isReady).toBe(true);
    await expect(waClient.sendMessage('test', 'test message')).resolves.not.toThrow();
  });

  test('waGatewayClient should throw error when not ready', async () => {
    await initializeWAService();
    
    // wa-gateway is not ready and should throw error
    expect(waGatewayClient.isReady).toBe(false);
    await expect(waGatewayClient.sendMessage('test', 'test message')).rejects.toThrow('Client wa-gateway is not ready');
  });

  test('service should fail only if NO clients are ready', async () => {
    // Mock scenario where ALL clients fail
    const { waService } = await import('../src/wa/compatibility.js');
    waService.waitForAllReady.mockResolvedValueOnce([
      { clientId: 'wa-client', status: 'failed', ready: false, error: 'LOGGED_OUT' },
      { clientId: 'wa-gateway', status: 'failed', ready: false, error: 'LOGGED_OUT' }
    ]);
    
    // Reset the initialization using jest.isolateModules for proper isolation
    jest.resetModules();
    await jest.isolateModules(async () => {
      const waServiceModule2 = await import('../src/service/waService.js');
      
      // Should throw because no clients are ready
      await expect(waServiceModule2.initializeWAService()).rejects.toThrow(
        '[waService] No clients are ready. At least one client must be ready to proceed.'
      );
    });
  });
});
