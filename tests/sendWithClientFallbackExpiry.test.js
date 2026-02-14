import { jest } from '@jest/globals';

let sendWithClientFallback;
let getBlockedGroups;
let unblockGroup;
let clearAllBlockedGroups;
let stopCleanupInterval;

beforeAll(async () => {
  const waHelper = await import('../src/utils/waHelper.js');
  sendWithClientFallback = waHelper.sendWithClientFallback;
  getBlockedGroups = waHelper.getBlockedGroups;
  unblockGroup = waHelper.unblockGroup;
  clearAllBlockedGroups = waHelper.clearAllBlockedGroups;
  stopCleanupInterval = waHelper.stopCleanupInterval;
});

beforeEach(() => {
  // Clear all blocked groups before each test
  clearAllBlockedGroups();
});

afterAll(() => {
  // Clean up the interval to prevent test leaks
  if (stopCleanupInterval) {
    stopCleanupInterval();
  }
});

test('blocked group appears in getBlockedGroups list', async () => {
  const groupPermissionError = new Error('Cannot send message to group: Bot lacks permission or was removed from group');
  groupPermissionError.statusCode = 403;

  const mockClient = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockRejectedValue(groupPermissionError),
  };

  const groupId = '120363422962355018@g.us';
  const message = 'Test message';
  
  const clients = [
    { client: mockClient, label: 'WA-GATEWAY' },
  ];

  // Trigger the block
  await sendWithClientFallback({
    chatId: groupId,
    message,
    clients,
  });

  // Check the blocked groups list
  const blockedGroups = getBlockedGroups();
  expect(blockedGroups.length).toBe(1);
  expect(blockedGroups[0].chatId).toBe(groupId);
  expect(blockedGroups[0].ageMinutes).toBeLessThanOrEqual(1); // Just blocked, allow small timing variance
  expect(blockedGroups[0].reason).toContain('Cannot send message');
});

test('unblockGroup manually unblocks a blocked group', async () => {
  const groupPermissionError = new Error('Cannot send message to group: Bot lacks permission');
  groupPermissionError.statusCode = 403;

  const mockClient = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn()
      .mockRejectedValueOnce(groupPermissionError) // First call fails
      .mockResolvedValue({ key: { id: 'msg123' } }), // Second call succeeds
  };

  const groupId = '999888777666@g.us';
  const message = 'Test message';
  
  const clients = [
    { client: mockClient, label: 'WA-CLIENT' },
  ];

  // First attempt - triggers block
  const result1 = await sendWithClientFallback({
    chatId: groupId,
    message,
    clients,
  });

  expect(result1).toBe(false);
  expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);

  // Verify group is blocked
  let blockedGroups = getBlockedGroups();
  expect(blockedGroups.length).toBe(1);
  expect(blockedGroups[0].chatId).toBe(groupId);

  // Manually unblock the group
  const unblocked = unblockGroup(groupId);
  expect(unblocked).toBe(true);

  // Verify group is no longer blocked
  blockedGroups = getBlockedGroups();
  expect(blockedGroups.length).toBe(0);

  // Second attempt - should try again and succeed
  const result2 = await sendWithClientFallback({
    chatId: groupId,
    message: 'Another message',
    clients,
  });

  expect(result2).toBe(true);
  expect(mockClient.sendMessage).toHaveBeenCalledTimes(2);
});

test('clearAllBlockedGroups removes all blocked groups', async () => {
  const groupPermissionError = new Error('Bot lacks permission');
  groupPermissionError.statusCode = 403;

  const mockClient = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockRejectedValue(groupPermissionError),
  };

  const clients = [
    { client: mockClient, label: 'WA-CLIENT' },
  ];

  // Block multiple groups
  const groupIds = [
    '111222333444@g.us',
    '555666777888@g.us',
    '999000111222@g.us',
  ];

  for (const groupId of groupIds) {
    await sendWithClientFallback({
      chatId: groupId,
      message: 'Test',
      clients,
    });
  }

  // Verify all groups are blocked
  let blockedGroups = getBlockedGroups();
  expect(blockedGroups.length).toBe(3);

  // Clear all blocks
  const clearedCount = clearAllBlockedGroups();
  expect(clearedCount).toBe(3);

  // Verify no groups are blocked
  blockedGroups = getBlockedGroups();
  expect(blockedGroups.length).toBe(0);
});

test('unblockGroup returns false for non-blocked group', () => {
  const result = unblockGroup('nonexistent@g.us');
  expect(result).toBe(false);
});

test('getBlockedGroups returns empty array when no groups blocked', () => {
  const blockedGroups = getBlockedGroups();
  expect(blockedGroups).toEqual([]);
});
