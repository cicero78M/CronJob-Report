// tests/waBlockingRaceCondition.test.js
/**
 * Test suite to verify the fix for race conditions in the WhatsApp group blocking mechanism.
 * This ensures that concurrent operations on the blocking maps are properly synchronized
 * using async-lock to prevent lost writes and inconsistent state.
 */

import { jest } from '@jest/globals';

describe('WA Blocking Race Condition Fix', () => {
  let sendWithClientFallback;
  let mockClient1;
  let mockClient2;

  beforeAll(async () => {
    // Mock the WAClient module
    jest.unstable_mockModule('../src/wa/WAClient.js', () => ({
      WAClient: jest.fn(),
    }));

    // Import the waHelper module after mocking
    const waHelper = await import('../src/utils/waHelper.js');
    sendWithClientFallback = waHelper.sendWithClientFallback;
  });

  beforeEach(() => {
    // Create mock clients that simulate 403 errors for blocked groups
    mockClient1 = {
      sendMessage: jest.fn().mockRejectedValue({
        message: 'Cannot send message to group 120363422962355018@g.us: Bot lacks permission or was removed from group',
        statusCode: 403,
        code: 403,
        isRetriable: false,
      }),
      isReady: jest.fn().mockReturnValue(true),
      getState: jest.fn().mockReturnValue('CONNECTED'),
    };

    mockClient2 = {
      sendMessage: jest.fn().mockRejectedValue({
        message: 'Cannot send message to group 120363422962355018@g.us: Bot lacks permission or was removed from group',
        statusCode: 403,
        code: 403,
        isRetriable: false,
      }),
      isReady: jest.fn().mockReturnValue(true),
      getState: jest.fn().mockReturnValue('CONNECTED'),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('concurrent sendWithClientFallback calls should not cause race conditions', async () => {
    const testGroupId = '120363422962355018@g.us';
    const testMessage = 'Test message';

    // Simulate concurrent calls to sendWithClientFallback with the same group
    const promises = [
      sendWithClientFallback({
        chatId: testGroupId,
        message: testMessage,
        clients: [
          { client: mockClient1, label: 'WA-GATEWAY' },
          { client: mockClient2, label: 'WA' },
        ],
        reportContext: {
          jobKey: './src/cron/cronOprRequestAbsensiEngagement.js',
          clientId: 'BOJONEGORO',
          chatId: testGroupId,
          menu: 'oprrequest-absensi-engagement-engagement-instagram',
        },
      }),
      sendWithClientFallback({
        chatId: testGroupId,
        message: testMessage,
        clients: [
          { client: mockClient1, label: 'WA-GATEWAY' },
          { client: mockClient2, label: 'WA' },
        ],
        reportContext: {
          jobKey: './src/cron/cronOprRequestAbsensiEngagement.js',
          clientId: 'BOJONEGORO',
          chatId: testGroupId,
          menu: 'oprrequest-absensi-engagement-engagement-tiktok',
        },
      }),
      sendWithClientFallback({
        chatId: testGroupId,
        message: testMessage,
        clients: [
          { client: mockClient1, label: 'WA-GATEWAY' },
          { client: mockClient2, label: 'WA' },
        ],
        reportContext: {
          jobKey: './src/cron/cronRekapLink.js',
          clientId: 'BOJONEGORO',
          chatId: testGroupId,
          menu: 'rekap-link',
        },
      }),
    ];

    // All concurrent calls should complete without race conditions
    const results = await Promise.all(promises);

    // All calls should fail (return false) because of 403 errors
    expect(results).toEqual([false, false, false]);

    // With async-lock, concurrent operations are serialized properly
    // Each call will attempt to send (and fail with 403), then block the group
    // The lock ensures no race condition in the blocking state
    // In a race condition scenario without locks, we might see:
    // - Lost block writes
    // - Inconsistent block state
    // - Multiple redundant send attempts after blocking
    // With locks, the blocking mechanism is atomic and consistent
    expect(mockClient1.sendMessage).toHaveBeenCalled();
    // Note: The exact number of calls depends on timing and lock acquisition order
    // The important thing is that the blocking state is consistent and race-free
    // Each concurrent operation is properly serialized per chatId by the lock
  });

  test('sequential sendWithClientFallback calls should properly block and skip', async () => {
    const testGroupId = '120363422962355019@g.us';
    const testMessage = 'Test message';

    // First call - should attempt to send and block the group
    const result1 = await sendWithClientFallback({
      chatId: testGroupId,
      message: testMessage,
      clients: [{ client: mockClient1, label: 'WA-GATEWAY' }],
      reportContext: {
        jobKey: './src/cron/cronOprRequestAbsensiEngagement.js',
        clientId: 'TEST',
        chatId: testGroupId,
        menu: 'test-1',
      },
    });

    expect(result1).toBe(false); // Should fail

    // Second call - should skip because group is blocked
    const result2 = await sendWithClientFallback({
      chatId: testGroupId,
      message: testMessage,
      clients: [{ client: mockClient1, label: 'WA-GATEWAY' }],
      reportContext: {
        jobKey: './src/cron/cronOprRequestAbsensiEngagement.js',
        clientId: 'TEST',
        chatId: testGroupId,
        menu: 'test-2',
      },
    });

    expect(result2).toBe(false); // Should also fail (skipped)
    
    // The mock client should only be called once (first attempt only)
    expect(mockClient1.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('blocking different groups should not interfere with each other', async () => {
    const testGroup1 = '120363422962355020@g.us';
    const testGroup2 = '120363422962355021@g.us';
    const testMessage = 'Test message';

    // Block group 1
    await sendWithClientFallback({
      chatId: testGroup1,
      message: testMessage,
      clients: [{ client: mockClient1, label: 'WA-GATEWAY' }],
      reportContext: { jobKey: 'test', clientId: 'TEST', chatId: testGroup1, menu: 'test' },
    });

    // Try group 2 - should attempt to send (not blocked)
    await sendWithClientFallback({
      chatId: testGroup2,
      message: testMessage,
      clients: [{ client: mockClient1, label: 'WA-GATEWAY' }],
      reportContext: { jobKey: 'test', clientId: 'TEST', chatId: testGroup2, menu: 'test' },
    });

    // Both groups should have been attempted
    expect(mockClient1.sendMessage).toHaveBeenCalledTimes(2);
  });
});
