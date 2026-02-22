import { jest } from '@jest/globals';

const mockScheduleCronJob = jest.fn();
const mockSendDebug = jest.fn();
const mockFetchAndStoreInstaContent = jest.fn();
const mockFindAllActiveOrgAmplifyClients = jest.fn();
const mockAcquireDistributedLock = jest.fn();

jest.unstable_mockModule('../src/utils/cronScheduler.js', () => ({
  scheduleCronJob: mockScheduleCronJob,
}));

jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendDebug: mockSendDebug,
}));

jest.unstable_mockModule('../src/handler/fetchpost/instaFetchPost.js', () => ({
  fetchAndStoreInstaContent: mockFetchAndStoreInstaContent,
}));

jest.unstable_mockModule('../src/model/clientModel.js', () => ({
  findAllActiveOrgAmplifyClients: mockFindAllActiveOrgAmplifyClients,
}));

jest.unstable_mockModule('../src/service/distributedLockService.js', () => ({
  acquireDistributedLock: mockAcquireDistributedLock,
}));

let runCron;

beforeAll(async () => {
  ({ runCron } = await import('../src/cron/cronOprRequestAmplifyRoutineUpdate.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('runCron memproses list client aktif+amplify dan skip akun IG yang tidak valid', async () => {
  const release = jest.fn().mockResolvedValue(undefined);
  mockAcquireDistributedLock.mockResolvedValueOnce({ acquired: true, release });
  mockFindAllActiveOrgAmplifyClients.mockResolvedValueOnce([
    {
      client_id: 'ORG-INACTIVE-IG',
      client_insta_status: false,
      client_insta: 'orginactive',
    },
    {
      client_id: 'ORG-EMPTY-USERNAME',
      client_insta_status: true,
      client_insta: '   ',
    },
    {
      client_id: 'ORG-ACTIVE-IG',
      client_insta_status: true,
      client_insta: 'orgactive',
    },
  ]);

  await runCron();

  expect(mockFetchAndStoreInstaContent).toHaveBeenCalledTimes(1);
  expect(mockFetchAndStoreInstaContent).toHaveBeenCalledWith(
    null,
    null,
    null,
    'ORG-ACTIVE-IG'
  );
  expect(mockSendDebug).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: expect.stringContaining('[ORG-INACTIVE-IG] Skip update tugas rutin (reason=instagram_inactive)'),
    })
  );

  expect(mockSendDebug).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: expect.stringContaining('[ORG-EMPTY-USERNAME] Skip update tugas rutin (reason=instagram_username_missing)'),
    })
  );
  expect(release).toHaveBeenCalledTimes(1);
});

test('runCron skip ketika lock sudah dipegang instance lain', async () => {
  mockAcquireDistributedLock.mockResolvedValueOnce({
    acquired: false,
    reason: 'lock_held',
    release: jest.fn(),
  });

  await runCron();

  expect(mockFindAllActiveOrgAmplifyClients).not.toHaveBeenCalled();
  expect(mockFetchAndStoreInstaContent).not.toHaveBeenCalled();
  expect(mockSendDebug).toHaveBeenCalledWith(
    expect.objectContaining({
      msg: expect.stringContaining('Lewati cron: lock sudah diambil oleh instance lain (lock_held)'),
    })
  );
});
