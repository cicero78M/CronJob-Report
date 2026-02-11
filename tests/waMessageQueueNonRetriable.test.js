/**
 * Test: WAMessageQueue Non-Retriable Error Handling
 * 
 * Verifies that WAMessageQueue properly stops retrying
 * when encountering non-retriable errors like 403 forbidden
 */

import { jest } from '@jest/globals';

describe('WAMessageQueue non-retriable error handling', () => {
  let WAMessageQueue, WAError;
  let mockClient;
  let queue;

  beforeEach(async () => {
    // Reset modules before each test
    jest.resetModules();

    // Mock client
    mockClient = {
      sendMessage: jest.fn(),
      isReady: true
    };

    // Import modules
    const waClientModule = await import('../src/wa/WAClient.js');
    WAError = waClientModule.WAError;
    
    const queueModule = await import('../src/wa/WAMessageQueue.js');
    WAMessageQueue = queueModule.WAMessageQueue;
  });

  afterEach(async () => {
    // Cleanup queue to prevent hanging
    if (queue) {
      await queue.disconnect();
      queue = null;
    }
  });

  test('should not retry when error is non-retriable', async () => {
    queue = new WAMessageQueue({ clientId: 'test-queue' });
    
    const forbiddenError = new WAError('Bot lacks permission', {
      isRetriable: false,
      statusCode: 403
    });
    
    mockClient.sendMessage.mockRejectedValue(forbiddenError);

    try {
      await queue.schedule(mockClient, '1234567890@s.whatsapp.net', 'Test message');
      fail('Should have thrown error');
    } catch (error) {
      expect(error).toBe(forbiddenError);
      // sendMessage should be called only once, no retries
      expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
    }
  }, 10000); // 10 second timeout

  test('should retry when error is retriable', async () => {
    queue = new WAMessageQueue({ clientId: 'test-queue' });
    
    const networkError = new WAError('Network timeout', {
      isRetriable: true
    });
    
    // Fail 2 times, then succeed
    mockClient.sendMessage
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ key: { id: 'msg-id' } });

    // Should eventually succeed after retries
    const result = await queue.schedule(mockClient, '1234567890@s.whatsapp.net', 'Test message');
    
    expect(result).toEqual({ key: { id: 'msg-id' } });
    // Should be called 3 times (initial + 2 retries)
    expect(mockClient.sendMessage).toHaveBeenCalledTimes(3);
  }, 15000); // 15 second timeout for retries

  test('should handle regular errors with retry logic', async () => {
    queue = new WAMessageQueue({ clientId: 'test-queue' });
    
    const regularError = new Error('Some error');
    
    // Fail once, then succeed
    mockClient.sendMessage
      .mockRejectedValueOnce(regularError)
      .mockResolvedValueOnce({ key: { id: 'msg-id' } });

    // Should eventually succeed after retries
    const result = await queue.schedule(mockClient, '1234567890@s.whatsapp.net', 'Test message');
    
    expect(result).toEqual({ key: { id: 'msg-id' } });
    // Should be called 2 times (initial + 1 retry)
    expect(mockClient.sendMessage).toHaveBeenCalledTimes(2);
  }, 10000); // 10 second timeout

  test('should stop retrying after max attempts for retriable errors', async () => {
    queue = new WAMessageQueue({ clientId: 'test-queue' });
    
    const networkError = new WAError('Network timeout', {
      isRetriable: true
    });
    
    mockClient.sendMessage.mockRejectedValue(networkError);

    try {
      await queue.schedule(mockClient, '1234567890@s.whatsapp.net', 'Test message');
      fail('Should have thrown error');
    } catch (error) {
      expect(error).toBe(networkError);
      // Should be called 4 times (initial + 3 retries)
      expect(mockClient.sendMessage).toHaveBeenCalledTimes(4);
    }
  }, 15000); // 15 second timeout for retries
});
