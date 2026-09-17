import { jest } from '@jest/globals';

const scheduleCronJob = jest.fn((jobKey, cronExpression, handler, options) => {
  scheduledJobs.push({ jobKey, cronExpression, handler, options });
  return { jobKey, cronExpression, handler };
});

const waGatewayClient = {};

// Isolate registration from cron modules that open DB/WhatsApp resources at import time.
const cronModuleMocks = {
  '../src/cron/cronDirRequestDitbinmasGroupRecap.js': 'ditbinmas-group-job',
  '../src/cron/cronDirRequestDitbinmasSuperAdminDaily.js':
    'ditbinmas-daily-job',
  '../src/cron/cronDirRequestDitbinmasSuperAdminMonthly.js':
    'ditbinmas-monthly-job',
  '../src/cron/cronDirRequestDitbinmasOperatorDaily.js':
    'ditbinmas-operator-job',
  '../src/cron/cronDirRequestDitbinmasAbsensiToday.js': 'ditbinmas-absensi-job',
  '../src/cron/cronDirRequestDitbinmasTiktok1940.js':
    'ditbinmas-tiktok-1940-job',
  '../src/cron/cronDirRequestDitintelkamMorning.js': 'ditintelkam-morning-job',
  '../src/cron/cronDirRequestDitintelkamRoutine.js': 'ditintelkam-routine-job',
};

for (const [modulePath, jobKey] of Object.entries(cronModuleMocks)) {
  jest.unstable_mockModule(modulePath, () => ({
    runCron: jest.fn(),
    runCronAt2202: jest.fn(),
    JOB_KEY: jobKey,
  }));
}

const originalJestWorkerId = process.env.JEST_WORKER_ID;
let scheduledJobs = [];

afterAll(() => {
  if (originalJestWorkerId === undefined) delete process.env.JEST_WORKER_ID;
  else process.env.JEST_WORKER_ID = originalJestWorkerId;
});

beforeEach(() => {
  jest.resetModules();
  scheduledJobs = [];
  scheduleCronJob.mockClear();
  delete process.env.JEST_WORKER_ID;
});

async function loadModules() {
  jest.unstable_mockModule('../src/config/env.js', () => ({
    env: { ENABLE_DIRREQUEST_GROUP: true },
  }));

  jest.unstable_mockModule('../src/utils/cronScheduler.js', () => ({
    scheduleCronJob,
  }));

  jest.unstable_mockModule('../src/cron/cronWaNotificationReminder.js', () => ({
    runCron: jest.fn(),
    JOB_KEY: 'reminder-job',
  }));

  jest.unstable_mockModule(
    '../src/cron/cronDirRequestBidhumasEvening.js',
    () => ({
      runCron: jest.fn(),
      JOB_KEY: 'bidhumas-evening-job',
    })
  );

  const dirRequest = await import('../src/cron/dirRequest/index.js');

  return {
    registerDirRequestCrons: dirRequest.registerDirRequestCrons,
  };
}

test('registerDirRequestCrons schedules all configured jobs', async () => {
  const { registerDirRequestCrons } = await loadModules();

  registerDirRequestCrons(waGatewayClient);

  const scheduleMap = scheduledJobs.reduce((acc, job) => {
    acc[job.jobKey] = acc[job.jobKey]
      ? [...acc[job.jobKey], job.cronExpression]
      : [job.cronExpression];
    return acc;
  }, {});

  expect(scheduleMap).toEqual({
    'reminder-job': ['5 17 * * *', '35 17 * * *', '35 18 * * *', '5 19 * * *'],
    'bidhumas-evening-job': ['45 15 * * *', '15 20 * * *', '15 22 * * *'],
    'ditbinmas-group-job': ['11 15 * * *', '11 18 * * *', '55 20 * * *'],
    'ditbinmas-daily-job': ['45 20 * * *'],
    'ditbinmas-monthly-job': ['0 22 28-31 * *'],
    'ditbinmas-operator-job': ['47 20 * * *'],
    'ditbinmas-absensi-job': ['49 20 * * *'],
    'ditbinmas-tiktok-1940-job': ['40 19 * * *'],
    'ditintelkam-morning-job': ['02 7 * * *', '02 22 * * *'],
    'ditintelkam-routine-job': ['9 16,20,22 * * *'],
  });
});
