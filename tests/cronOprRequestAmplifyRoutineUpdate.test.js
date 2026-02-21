import { jest } from '@jest/globals';

const mockScheduleCronJob = jest.fn();
const mockSendDebug = jest.fn();
const mockFetchAndStoreInstaContent = jest.fn();
const mockFindAllActiveOrgAmplifyClients = jest.fn();

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

let runCron;

beforeAll(async () => {
  ({ runCron } = await import('../src/cron/cronOprRequestAmplifyRoutineUpdate.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('runCron hanya memproses client amplify org dengan instagram aktif', async () => {
  mockFindAllActiveOrgAmplifyClients.mockResolvedValueOnce([
    {
      client_id: 'ORG-INACTIVE-IG',
      client_insta_status: false,
      client_insta: 'orginactive',
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
      msg: expect.stringContaining('[ORG-INACTIVE-IG] Lewati update tugas rutin: status Instagram client tidak aktif.'),
    })
  );
});
