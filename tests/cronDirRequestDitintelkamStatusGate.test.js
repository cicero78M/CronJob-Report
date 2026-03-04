import { jest } from '@jest/globals';

const mockRunDirRequestAction = jest.fn();
const mockFindClientById = jest.fn();
const mockAcquireDistributedLock = jest.fn();
const mockSendDebug = jest.fn();
const mockSendWithClientFallback = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../src/service/dirRequestService.js', () => ({
  runDirRequestAction: mockRunDirRequestAction,
}));

jest.unstable_mockModule('../src/service/clientService.js', () => ({
  findClientById: mockFindClientById,
}));

jest.unstable_mockModule('../src/service/distributedLockService.js', () => ({
  acquireDistributedLock: mockAcquireDistributedLock,
}));

jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendDebug: mockSendDebug,
}));

jest.unstable_mockModule('../src/utils/waHelper.js', () => ({
  sendWithClientFallback: mockSendWithClientFallback,
  getAdminWAIds: () => ['6281234567890'],
  normalizeUserWhatsAppId: () => '6281234567890@s.whatsapp.net',
  minPhoneDigitLength: 10,
  normalizeGroupId: (value) => value,
}));

jest.unstable_mockModule('../src/repository/clientContactRepository.js', () => ({
  splitRecipientField: () => [],
}));

jest.unstable_mockModule('../src/cron/waClientRouting.js', () => ({
  getDirectorateWaRoute: () => ({
    primaryClient: {},
    reportClient: {},
    fallbackClients: [],
  }),
}));

jest.unstable_mockModule('../src/cron/dirRequestThrottle.js', () => ({
  delayAfterSend: jest.fn().mockResolvedValue(undefined),
}));

describe('ditintelkam cron status gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('morning cron skip saat client_status false', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    mockAcquireDistributedLock.mockResolvedValueOnce({ acquired: true, release });
    mockFindClientById.mockResolvedValueOnce({
      client_status: false,
      client_insta_status: true,
      client_tiktok_status: true,
      client_group: '1203630@g.us',
    });

    const { runCron } = await import('../src/cron/cronDirRequestDitintelkamMorning.js');
    await runCron();

    expect(mockRunDirRequestAction).not.toHaveBeenCalled();
    expect(mockSendDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.objectContaining({
          sendStatus: expect.stringContaining('reason=client_inactive'),
        }),
      })
    );
    expect(mockSendDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('client_status=false'),
      })
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  test('routine cron skip saat client_tiktok_status false', async () => {
    const release = jest.fn().mockResolvedValue(undefined);
    mockAcquireDistributedLock.mockResolvedValueOnce({ acquired: true, release });
    mockFindClientById.mockResolvedValueOnce({
      client_status: true,
      client_insta_status: true,
      client_tiktok_status: false,
      client_group: '1203630@g.us',
    });

    const { runCron } = await import('../src/cron/cronDirRequestDitintelkamRoutine.js');
    await runCron();

    expect(mockRunDirRequestAction).not.toHaveBeenCalled();
    expect(mockSendDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.objectContaining({
          sendStatus: expect.stringContaining('reason=tiktok_inactive'),
        }),
      })
    );
    expect(mockSendDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('client_tiktok_status=false'),
      })
    );
    expect(release).toHaveBeenCalledTimes(1);
  });
});
