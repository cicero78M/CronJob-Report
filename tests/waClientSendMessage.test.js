/**
 * Test: WAClient sendMessage options normalization
 * 
 * Verifies that sendMessage properly handles null/undefined options
 * to prevent "Cannot read properties of undefined (reading 'markedUnread')" error
 */

import { jest } from '@jest/globals';

describe('WAClient sendMessage options normalization', () => {
  let WAClient;
  let mockWhatsAppClient;

  beforeEach(async () => {
    // Reset modules before each test
    jest.resetModules();

    // Create a mock whatsapp-web.js client
    mockWhatsAppClient = {
      sendMessage: jest.fn().mockResolvedValue({ id: 'test-message-id' }),
      initialize: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      destroy: jest.fn().mockResolvedValue(undefined),
      getState: jest.fn().mockResolvedValue('CONNECTED'),
    };

    // Mock whatsapp-web.js package
    jest.unstable_mockModule('whatsapp-web.js', () => ({
      default: {
        Client: jest.fn().mockImplementation(() => mockWhatsAppClient),
        LocalAuth: jest.fn().mockImplementation(() => ({})),
      },
      Client: jest.fn().mockImplementation(() => mockWhatsAppClient),
      LocalAuth: jest.fn().mockImplementation(() => ({})),
    }));

    // Mock qrcode-terminal
    jest.unstable_mockModule('qrcode-terminal', () => ({
      default: {
        generate: jest.fn(),
      },
      generate: jest.fn(),
    }));

    // Import WAClient after setting up mocks
    const waClientModule = await import('../src/wa/WAClient.js');
    WAClient = waClientModule.WAClient;
  });

  test('sendMessage should normalize null options to empty object', async () => {
    const client = new WAClient({ clientId: 'test-client' });
    client.isReady = true;
    client.client = mockWhatsAppClient;

    // Call sendMessage with null options
    await client.sendMessage('1234567890@c.us', 'Test message', null);

    // Verify that sendMessage was called with an empty object instead of null
    expect(mockWhatsAppClient.sendMessage).toHaveBeenCalledWith(
      '1234567890@c.us',
      'Test message',
      {}
    );
  });

  test('sendMessage should normalize undefined options to empty object', async () => {
    const client = new WAClient({ clientId: 'test-client' });
    client.isReady = true;
    client.client = mockWhatsAppClient;

    // Call sendMessage with undefined options
    await client.sendMessage('1234567890@c.us', 'Test message', undefined);

    // Verify that sendMessage was called with an empty object instead of undefined
    expect(mockWhatsAppClient.sendMessage).toHaveBeenCalledWith(
      '1234567890@c.us',
      'Test message',
      {}
    );
  });

  test('sendMessage should preserve valid options object', async () => {
    const client = new WAClient({ clientId: 'test-client' });
    client.isReady = true;
    client.client = mockWhatsAppClient;

    const options = { sendSeen: false, media: null };

    // Call sendMessage with valid options
    await client.sendMessage('1234567890@c.us', 'Test message', options);

    // Verify that options were passed through unchanged
    expect(mockWhatsAppClient.sendMessage).toHaveBeenCalledWith(
      '1234567890@c.us',
      'Test message',
      options
    );
  });

  test('sendMessage should use empty object when no options parameter provided', async () => {
    const client = new WAClient({ clientId: 'test-client' });
    client.isReady = true;
    client.client = mockWhatsAppClient;

    // Call sendMessage without options parameter
    await client.sendMessage('1234567890@c.us', 'Test message');

    // Verify that sendMessage was called with an empty object as default
    expect(mockWhatsAppClient.sendMessage).toHaveBeenCalledWith(
      '1234567890@c.us',
      'Test message',
      {}
    );
  });
});
