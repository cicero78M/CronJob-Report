import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockAbsensiLink = jest.fn();
const mockAbsensiLinkKhusus = jest.fn();
const mockSendMessage = jest.fn();
const mockSendWithClientFallback = jest.fn(async ({ reportClient, chatId, message }) => {
  await reportClient.sendMessage(chatId, message);
  return true;
});
const mockSendDebug = jest.fn();

jest.unstable_mockModule('../src/db/index.js', () => ({ query: mockQuery }));
jest.unstable_mockModule('../src/handler/fetchabsensi/link/absensiLinkAmplifikasi.js', () => ({
  absensiLink: mockAbsensiLink,
}));
jest.unstable_mockModule('../src/handler/fetchabsensi/link/absensiLinkKhusus.js', () => ({
  absensiLinkKhusus: mockAbsensiLinkKhusus,
}));
jest.unstable_mockModule('../src/service/waService.js', () => ({
  default: { sendMessage: mockSendMessage },
  waGatewayClient: { sendMessage: mockSendMessage },
}));
jest.unstable_mockModule('../src/utils/waHelper.js', () => ({
  normalizeUserWhatsAppId: (value) => `${String(value).replace(/\D/g, '')}@c.us`,
  minPhoneDigitLength: 8,
  sendWithClientFallback: mockSendWithClientFallback,
}));
jest.unstable_mockModule('../src/service/distributedLockService.js', () => ({
  acquireDistributedLock: jest.fn().mockResolvedValue({ acquired: true, release: jest.fn() }),
}));
jest.unstable_mockModule('../src/utils/cronScheduler.js', () => ({
  scheduleCronJob: jest.fn(),
}));
jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendDebug: mockSendDebug,
}));

let getActiveClients, runCron;

beforeAll(async () => {
  ({ getActiveClients, runCron } = await import('../src/cron/cronRekapLink.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_WHATSAPP = '';
});

test('getActiveClients filters org clients', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await getActiveClients();

  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).toMatch(/LOWER\(client_type\) IN \('org', 'opr'\)/i);
});

test('runCron passes operator role to absensiLink', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [
      {
        client_id: 'ORG1',
        nama: 'Org 1',
        client_operator: '081234567890',
        client_super: null,
        client_group: null,
      },
    ],
  });
  mockAbsensiLink.mockResolvedValueOnce('report');
  mockAbsensiLinkKhusus.mockResolvedValueOnce('special-report');

  await runCron();

  expect(mockAbsensiLink).toHaveBeenCalledWith('ORG1', { roleFlag: 'operator' });
  expect(mockAbsensiLinkKhusus).toHaveBeenCalledWith('ORG1', { roleFlag: 'operator' });
  expect(mockSendMessage).toHaveBeenCalledWith('081234567890@c.us', 'report');
  expect(mockSendMessage).toHaveBeenCalledWith('081234567890@c.us', 'special-report');
});
