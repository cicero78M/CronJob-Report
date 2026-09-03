import { jest } from '@jest/globals';

const sendDebug = jest.fn();
const runMonthly = jest.fn().mockResolvedValue('ok');

jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({ sendDebug }));
jest.unstable_mockModule('../src/cron/cronDirRequestCustomSequence.js', () => ({
  runDitbinmasSuperAdminMonthlyRecap: runMonthly,
}));

const { isLastDayOfMonth, runCron } = await import(
  '../src/cron/cronDirRequestDitbinmasSuperAdminMonthly.js'
);

beforeEach(() => jest.clearAllMocks());

test.each([
  ['2026-02-28T15:00:00.000Z'],
  ['2026-04-30T15:00:00.000Z'],
  ['2026-09-30T15:00:00.000Z'],
  ['2026-12-31T15:00:00.000Z'],
])('recognizes month end in Jakarta: %s', (iso) => {
  expect(isLastDayOfMonth(new Date(iso))).toBe(true);
});

test('does not send before the final day of the month', async () => {
  const result = await runCron(new Date('2026-09-29T15:00:00.000Z'));
  expect(result).toBe('skipped_not_month_end');
  expect(runMonthly).not.toHaveBeenCalled();
});

test('sends the monthly sequence on the final day', async () => {
  const date = new Date('2026-09-30T15:00:00.000Z');
  await expect(runCron(date)).resolves.toBe('ok');
  expect(runMonthly).toHaveBeenCalledWith(date);
});
