/**
 * Test: WhatsApp Service Initialization
 * 
 * Verifies that the WhatsApp client initialization timing issue is fixed
 * by ensuring waitForWaReady() properly waits for initialization.
 */

import { jest } from '@jest/globals';

describe('waService initialization timing', () => {
  let waService;
  let initializeWAService;
  let waitForWaReady;
  let waClient;
  let mockWAClient;
  
  beforeEach(async () => {
    // Reset modules before each test
    jest.resetModules();
    
    // Create mock client that will be used
    mockWAClient = {
      initialize: jest.fn().mockResolvedValue(undefined),
      waitForReady: jest.fn().mockResolvedValue(true),
      isReady: false,
      on: jest.fn(),
    };
    
    // Mock the WAService and WAClient classes
    jest.unstable_mockModule('../src/wa/WAService.js', () => {
      return {
        waService: {
          createClient: jest.fn().mockReturnValue(mockWAClient),
          initializeClient: jest.fn().mockResolvedValue(undefined),
          getClient: jest.fn().mockReturnValue(mockWAClient),
          waitForAllReady: jest.fn().mockResolvedValue(undefined),
        },
        WAService: jest.fn().mockImplementation(() => ({
          createClient: jest.fn().mockReturnValue(mockWAClient),
          initializeClient: jest.fn().mockResolvedValue(undefined),
          getClient: jest.fn().mockReturnValue(mockWAClient),
          waitForAllReady: jest.fn().mockResolvedValue(undefined),
        })),
      };
    });
    
    jest.unstable_mockModule('../src/wa/compatibility.js', () => ({
      WAClientCompat: class {
        constructor(clientId) {
          this.clientId = clientId;
          this.sendMessage = jest.fn().mockResolvedValue(true);
          this.waitForWaReady = jest.fn().mockResolvedValue(true);
        }
      },
      waService: {
        createClient: jest.fn().mockReturnValue(mockWAClient),
        initializeClient: jest.fn().mockResolvedValue(undefined),
        getClient: jest.fn().mockReturnValue(mockWAClient),
        waitForAllReady: jest.fn().mockResolvedValue(undefined),
      },
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
        WA_WEB_VERSION_CACHE_URL: '',
        WA_WEB_VERSION: '',
      },
    }));
    
    // Import the actual module
    const waServiceModule = await import('../src/service/waService.js');
    initializeWAService = waServiceModule.initializeWAService;
    waitForWaReady = waServiceModule.waitForWaReady;
    waClient = waServiceModule.waClient;
  });

  test('waitForWaReady should throw error if called before initializeWAService', async () => {
    // Try to call waitForWaReady before initialization
    await expect(waitForWaReady()).rejects.toThrow(
      '[waService] Service not initialized. Call initializeWAService() first.'
    );
  });

  test('initializeWAService should complete successfully', async () => {
    // Initialize the service
    await expect(initializeWAService()).resolves.not.toThrow();
  });

  test('waitForWaReady should work after initializeWAService completes', async () => {
    // Initialize first
    await initializeWAService();
    
    // Now waitForWaReady should work (returns whatever the mock returns)
    await expect(waitForWaReady()).resolves.toBeDefined();
  });

  test('waClient proxy should throw error if accessed before initialization', () => {
    // Try to access waClient method before initialization
    expect(() => {
      waClient.sendMessage('test', 'test message');
    }).toThrow('[waService] waClient not initialized');
  });

  test('waClient proxy should work after initialization', async () => {
    // Initialize first
    await initializeWAService();
    
    // Now waClient should work
    expect(() => {
      waClient.sendMessage('test', 'test message');
    }).not.toThrow();
  });

  test('multiple calls to initializeWAService should return same promise', async () => {
    // Call initialize multiple times
    const promise1 = initializeWAService();
    const promise2 = initializeWAService();
    const promise3 = initializeWAService();
    
    // All should be the same promise object
    expect(promise1).toStrictEqual(promise2);
    expect(promise2).toStrictEqual(promise3);
    
    // And all should resolve successfully
    await expect(Promise.all([promise1, promise2, promise3])).resolves.toBeDefined();
  });

  test('initialization sequence should be correct', async () => {
    const { waService } = await import('../src/wa/compatibility.js');
    const { env } = await import('../src/config/env.js');
    
    // Initialize
    await initializeWAService();
    
    // Verify the correct sequence of calls
    expect(waService.createClient).toHaveBeenCalledTimes(2);
    
    // Verify wa-client configuration
    expect(waService.createClient).toHaveBeenNthCalledWith(1, 'wa-client', 
      expect.objectContaining({
        clientId: env.APP_SESSION_NAME || 'wa-admin',
        authPath: env.WA_AUTH_DATA_PATH,
        webVersionCacheUrl: env.WA_WEB_VERSION_CACHE_URL,
        webVersion: env.WA_WEB_VERSION
      })
    );
    
    // Verify wa-gateway configuration
    expect(waService.createClient).toHaveBeenNthCalledWith(2, 'wa-gateway',
      expect.objectContaining({
        clientId: env.GATEWAY_WA_CLIENT_ID || 'wa-gateway-prod',
        authPath: env.WA_AUTH_DATA_PATH,
        webVersionCacheUrl: env.WA_WEB_VERSION_CACHE_URL,
        webVersion: env.WA_WEB_VERSION
      })
    );
    
    expect(waService.initializeClient).toHaveBeenCalledTimes(2);
    
    // Verify that waitForAllReady was called with extended timeout
    expect(waService.waitForAllReady).toHaveBeenCalledTimes(1);
    expect(waService.waitForAllReady).toHaveBeenCalledWith(300000); // 5 minutes
  });
});
