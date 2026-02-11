/**
 * Test: WAClient 403 Forbidden Error Handling
 * 
 * Verifies that WAClient properly handles 403 forbidden errors
 * when sending messages to groups without retrying permanently failed operations
 */

import { jest } from '@jest/globals';

describe('WAClient 403 forbidden error handling', () => {
  let WAClient, WAError;
  let mockSocket;

  beforeEach(async () => {
    // Reset modules before each test
    jest.resetModules();

    // Mock Baileys socket
    mockSocket = {
      sendMessage: jest.fn(),
      groupMetadata: jest.fn(),
      user: { id: 'test@s.whatsapp.net', name: 'Test Bot' },
      ws: { readyState: 1 } // WebSocket.OPEN
    };

    // Mock @whiskeysockets/baileys
    jest.unstable_mockModule('@whiskeysockets/baileys', () => ({
      default: jest.fn(),
      useMultiFileAuthState: jest.fn().mockResolvedValue({
        state: {},
        saveCreds: jest.fn()
      }),
      fetchLatestBaileysVersion: jest.fn().mockResolvedValue({
        version: [2, 3000, 0]
      }),
      DisconnectReason: {
        loggedOut: 401,
        forbidden: 403,
        connectionClosed: 428
      },
      Browsers: {
        ubuntu: jest.fn().mockReturnValue(['Ubuntu', 'Chrome', '20.0.04'])
      }
    }));

    // Mock pino logger
    jest.unstable_mockModule('pino', () => ({
      default: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
      })
    }));

    // Mock qrcode-terminal
    jest.unstable_mockModule('qrcode-terminal', () => ({
      default: {
        generate: jest.fn()
      },
      generate: jest.fn()
    }));

    // Import WAClient and WAError after setting up mocks
    const waClientModule = await import('../src/wa/WAClient.js');
    WAClient = waClientModule.WAClient;
    WAError = waClientModule.WAError;
  });

  test('WAError should properly classify non-retriable errors', () => {
    const error = new WAError('Forbidden access', {
      isRetriable: false,
      statusCode: 403
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WAError);
    expect(error.isRetriable).toBe(false);
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('Forbidden access');
  });

  test('WAError should default to retriable when not specified', () => {
    const error = new WAError('Temporary network error');

    expect(error.isRetriable).toBe(true);
  });

  test('sendMessage should throw non-retriable WAError for 403 group metadata error', async () => {
    const client = new WAClient({ clientId: 'test-client' });
    client.isReady = true;
    client.socket = mockSocket;

    // Mock group metadata to throw 403 error
    const forbiddenError = new Error('forbidden');
    forbiddenError.output = { statusCode: 403 };
    forbiddenError.data = 403;
    mockSocket.groupMetadata.mockRejectedValue(forbiddenError);

    const groupJid = '120363419830216549@g.us';
    
    await expect(
      client.sendMessage(groupJid, 'Test message')
    ).rejects.toMatchObject({
      name: 'WAError',
      isRetriable: false,
      statusCode: 403
    });
  });

  test('sendMessage should not validate metadata for individual chats', async () => {
    const client = new WAClient({ clientId: 'test-client' });
    client.isReady = true;
    client.socket = mockSocket;

    mockSocket.sendMessage.mockResolvedValue({ key: { id: 'msg-id' } });

    const userJid = '1234567890@s.whatsapp.net';
    
    await client.sendMessage(userJid, 'Test message');

    // groupMetadata should NOT be called for individual chats
    expect(mockSocket.groupMetadata).not.toHaveBeenCalled();
    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      userJid,
      { text: 'Test message' },
      expect.any(Object)
    );
  });

  test('sendMessage should continue sending if group metadata succeeds', async () => {
    const client = new WAClient({ clientId: 'test-client' });
    client.isReady = true;
    client.socket = mockSocket;

    const groupJid = '120363419830216549@g.us';
    
    // Mock successful group metadata
    mockSocket.groupMetadata.mockResolvedValue({
      id: groupJid,
      subject: 'Test Group',
      participants: []
    });
    
    mockSocket.sendMessage.mockResolvedValue({ key: { id: 'msg-id' } });

    await client.sendMessage(groupJid, 'Test message');

    expect(mockSocket.groupMetadata).toHaveBeenCalledWith(groupJid);
    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      groupJid,
      { text: 'Test message' },
      expect.any(Object)
    );
  });

  test('sendMessage should classify 403 send errors as non-retriable', async () => {
    const client = new WAClient({ clientId: 'test-client' });
    client.isReady = true;
    client.socket = mockSocket;

    // Individual chat, so no group validation
    const userJid = '1234567890@s.whatsapp.net';
    
    // Mock 403 error during send
    const forbiddenError = new Error('forbidden');
    forbiddenError.output = { statusCode: 403 };
    forbiddenError.data = 403;
    mockSocket.sendMessage.mockRejectedValue(forbiddenError);

    await expect(
      client.sendMessage(userJid, 'Test message')
    ).rejects.toMatchObject({
      name: 'WAError',
      isRetriable: false
    });
  });

  test('sendMessage should classify other errors as retriable', async () => {
    const client = new WAClient({ clientId: 'test-client' });
    client.isReady = true;
    client.socket = mockSocket;

    const userJid = '1234567890@s.whatsapp.net';
    
    // Mock network timeout error
    const timeoutError = new Error('Connection timeout');
    mockSocket.sendMessage.mockRejectedValue(timeoutError);

    await expect(
      client.sendMessage(userJid, 'Test message')
    ).rejects.toMatchObject({
      name: 'WAError',
      isRetriable: true
    });
  });
});
