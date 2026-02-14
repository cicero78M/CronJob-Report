import { jest } from '@jest/globals';

let sendWithClientFallback;

beforeAll(async () => {
  ({ sendWithClientFallback } = await import('../src/utils/waHelper.js'));
});

test('sendWithClientFallback stops trying other clients when group returns 403', async () => {
  // Create a 403 error that simulates bot removal from group
  const groupPermissionError = new Error('Cannot send message to group: Bot lacks permission or was removed from group');
  groupPermissionError.statusCode = 403;

  // Mock client 1 (WA-GATEWAY)
  const mockClient1 = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockRejectedValue(groupPermissionError),
  };

  // Mock client 2 (WA)
  const mockClient2 = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockRejectedValue(groupPermissionError),
  };

  const groupId = '120363422962355018@g.us';
  const message = 'Test message';
  
  const clients = [
    { client: mockClient1, label: 'WA-GATEWAY' },
    { client: mockClient2, label: 'WA' },
  ];

  // First call - should try WA-GATEWAY, get 403, then stop (not try WA)
  const result1 = await sendWithClientFallback({
    chatId: groupId,
    message,
    clients,
    reportContext: { test: 'first-call' },
  });

  expect(result1).toBe(false);
  // Should try first client
  expect(mockClient1.sendMessage).toHaveBeenCalledTimes(1);
  // Should NOT try second client because group is blocked globally after 403
  expect(mockClient2.sendMessage).toHaveBeenCalledTimes(0);

  // Second call - should skip immediately without trying any client
  const result2 = await sendWithClientFallback({
    chatId: groupId,
    message: 'Another message',
    clients,
    reportContext: { test: 'second-call' },
  });

  expect(result2).toBe(false);
  // Should not make any additional attempts
  expect(mockClient1.sendMessage).toHaveBeenCalledTimes(1); // Still 1 from before
  expect(mockClient2.sendMessage).toHaveBeenCalledTimes(0); // Still 0
});

test('sendWithClientFallback continues trying clients for non-403 errors', async () => {
  const temporaryError = new Error('Network timeout');
  temporaryError.statusCode = 500;

  const mockClient1 = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockRejectedValue(temporaryError),
  };

  const mockClient2 = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg123' } }),
  };

  const groupId = '999888777666@g.us';
  const message = 'Test message';
  
  const clients = [
    { client: mockClient1, label: 'CLIENT-1' },
    { client: mockClient2, label: 'CLIENT-2' },
  ];

  const result = await sendWithClientFallback({
    chatId: groupId,
    message,
    clients,
  });

  expect(result).toBe(true);
  // Should try both clients (first fails with retries, second succeeds)
  // The first client will retry up to 3 times due to safeSendMessage retry logic
  expect(mockClient1.sendMessage.mock.calls.length).toBeGreaterThan(0);
  expect(mockClient2.sendMessage).toHaveBeenCalled();
});

test('sendWithClientFallback does not globally block non-group chats with 403', async () => {
  const permissionError = new Error('Permission denied');
  permissionError.statusCode = 403;

  const mockClient1 = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockRejectedValue(permissionError),
  };

  const mockClient2 = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockRejectedValue(permissionError),
  };

  const userId = '628123456789@c.us'; // Individual chat, not group
  const message = 'Test message';
  
  const clients = [
    { client: mockClient1, label: 'CLIENT-1' },
    { client: mockClient2, label: 'CLIENT-2' },
  ];

  const result = await sendWithClientFallback({
    chatId: userId,
    message,
    clients,
  });

  expect(result).toBe(false);
  // Should try both clients for non-group chats even with 403
  expect(mockClient1.sendMessage).toHaveBeenCalled();
  expect(mockClient2.sendMessage).toHaveBeenCalled();
});
