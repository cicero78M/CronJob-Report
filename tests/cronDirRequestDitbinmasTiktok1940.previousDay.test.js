import { jest } from '@jest/globals';

const runDirRequestAction = jest.fn().mockResolvedValue(undefined);
const delayAfterSend = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendDebug: jest.fn(),
}));
jest.unstable_mockModule('../src/service/dirRequestService.js', () => ({
  runDirRequestAction,
}));
jest.unstable_mockModule('../src/utils/waHelper.js', () => ({
  minPhoneDigitLength: 8,
  normalizeUserWhatsAppId: (value) => `${String(value).replace(/\D/g, '')}@c.us`,
}));
jest.unstable_mockModule('../src/cron/waClientRouting.js', () => ({
  getDirectorateWaRoute: () => ({ primaryClient: {}, fallbackClients: [] }),
}));
jest.unstable_mockModule('../src/cron/dirRequestThrottle.js', () => ({
  delayAfterSend,
}));

test('cron TikTok 19:40 memakai data hari sebelumnya untuk seluruh menu', async () => {
  const { runCron } = await import('../src/cron/cronDirRequestDitbinmasTiktok1940.js');
  const previousDay = new Date('2026-09-14T12:00:00.000Z');

  await runCron(previousDay);

  expect(runDirRequestAction).toHaveBeenCalledTimes(6);
  expect(runDirRequestAction.mock.calls.map(([args]) => args.action)).toEqual([
    '5',
    '6',
    '9',
    '10',
    '34',
    '35',
  ]);
  for (const [args] of runDirRequestAction.mock.calls) {
    expect(args.context).toMatchObject({
      period: 'daily',
      referenceDate: previousDay,
    });
    expect(args.fallbackContext.context).toMatchObject({
      period: 'daily',
      referenceDate: previousDay,
    });
  }
});
