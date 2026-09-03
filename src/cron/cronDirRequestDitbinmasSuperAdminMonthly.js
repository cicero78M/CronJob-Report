import { sendDebug } from '../middleware/debugHandler.js';
import { runDitbinmasSuperAdminMonthlyRecap } from './cronDirRequestCustomSequence.js';

export const JOB_KEY = './src/cron/cronDirRequestDitbinmasSuperAdminMonthly.js';
const CRON_TAG = 'CRON DIRREQ DITBINMAS MONTHLY 22:00';

export function isLastDayOfMonth(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(referenceDate);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export async function runCron(referenceDate = new Date()) {
  if (!isLastDayOfMonth(referenceDate)) {
    sendDebug({ tag: CRON_TAG, msg: 'Dilewati: hari ini bukan akhir bulan.' });
    return 'skipped_not_month_end';
  }

  sendDebug({
    tag: CRON_TAG,
    msg: 'Mulai laporan bulanan Ditbinmas menu 6/9/34/35.',
  });
  return runDitbinmasSuperAdminMonthlyRecap(referenceDate);
}

export default null;
