/**
 * Integration Test: Error Handling Flow
 * 
 * Simple integration test to verify the error handling flow works correctly
 */

import { jest } from '@jest/globals';

describe('Error handling integration', () => {
  test('WAError and WAMessageQueue integration', async () => {
    // Import modules
    const { WAError } = await import('../src/wa/WAClient.js');
    const { WAMessageQueue } = await import('../src/wa/WAMessageQueue.js');

    // Create a mock client
    const mockClient = {
      sendMessage: jest.fn(),
      isReady: true
    };

    // Test 1: Non-retriable error should not retry
    const queue1 = new WAMessageQueue({ clientId: 'test-integration-1' });
    const forbiddenError = new WAError('Group access forbidden', {
      isRetriable: false,
      statusCode: 403
    });
    mockClient.sendMessage.mockRejectedValueOnce(forbiddenError);

    try {
      await queue1.schedule(mockClient, '120363419830216549@g.us', 'Test');
      fail('Should have thrown error');
    } catch (error) {
      expect(error.isRetriable).toBe(false);
      expect(error.statusCode).toBe(403);
      expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
    }

    await queue1.disconnect();
    mockClient.sendMessage.mockClear();

    // Test 2: Retriable error should retry and eventually succeed
    const queue2 = new WAMessageQueue({ clientId: 'test-integration-2' });
    const retriableError = new WAError('Temporary error', {
      isRetriable: true
    });
    mockClient.sendMessage
      .mockRejectedValueOnce(retriableError)
      .mockResolvedValueOnce({ key: { id: 'success' } });

    const result = await queue2.schedule(mockClient, '1234567890@s.whatsapp.net', 'Test');
    
    expect(result).toEqual({ key: { id: 'success' } });
    expect(mockClient.sendMessage).toHaveBeenCalledTimes(2);

    await queue2.disconnect();
  }, 10000);

  test('Error classification based on status code', async () => {
    const { WAError } = await import('../src/wa/WAClient.js');

    // 403 should be non-retriable
    const forbidden = new WAError('Forbidden', {
      isRetriable: false,
      statusCode: 403
    });
    expect(forbidden.isRetriable).toBe(false);

    // 401 should be non-retriable
    const unauthorized = new WAError('Unauthorized', {
      isRetriable: false,
      statusCode: 401
    });
    expect(unauthorized.isRetriable).toBe(false);

    // Network errors should be retriable by default
    const networkError = new WAError('Connection timeout');
    expect(networkError.isRetriable).toBe(true);

    // Explicit retriable error
    const explicit = new WAError('Temporary issue', {
      isRetriable: true,
      statusCode: 500
    });
    expect(explicit.isRetriable).toBe(true);
  });
});
