import { scheduleCronJob } from '../utils/cronScheduler.js';
import { sendDebug } from '../middleware/debugHandler.js';
import { fetchAndStoreInstaContent } from '../handler/fetchpost/instaFetchPost.js';
import { findAllActiveOrgAmplifyClients } from '../model/clientModel.js';
import { acquireDistributedLock } from '../service/distributedLockService.js';

export const JOB_KEY = './src/cron/cronOprRequestAmplifyRoutineUpdate.js';
const CRON_EXPRESSION = '55,25 8-21 * * *';
const CRON_OPTIONS = { timezone: 'Asia/Jakarta' };
const CRON_TAG = 'CRON OPRREQUEST UPDATE TUGAS RUTIN AMPLIFIKASI';
const DISTRIBUTED_LOCK_KEY = 'cron:oprrequest:amplify-routine-update';
const CRON_MAX_RUN_MINUTES = 20;
const LOCK_TTL_SECONDS = (CRON_MAX_RUN_MINUTES + 5) * 60;

async function runUpdateForClient(client) {
  if (client?.client_insta_status === false) {
    sendDebug({
      tag: CRON_TAG,
      msg: `[${client.client_id}] Lewati update tugas rutin: status Instagram client tidak aktif.`,
    });
    return;
  }

  if (!client?.client_insta) {
    sendDebug({
      tag: CRON_TAG,
      msg: `[${client.client_id}] Lewati update tugas rutin: username Instagram belum terdaftar.`,
    });
    return;
  }

  await fetchAndStoreInstaContent(null, null, null, client.client_id);

  sendDebug({
    tag: CRON_TAG,
    msg: `[${client.client_id}] Update tugas rutin selesai.`,
  });
}

export async function runCron() {
  const distributedLock = await acquireDistributedLock({
    key: DISTRIBUTED_LOCK_KEY,
    ttlSeconds: LOCK_TTL_SECONDS,
  });

  if (!distributedLock.acquired) {
    sendDebug({
      tag: CRON_TAG,
      msg: `Lewati cron: lock sudah diambil oleh instance lain (${distributedLock.reason || 'lock_held'})`,
    });
    return;
  }

  sendDebug({
    tag: CRON_TAG,
    msg: 'Mulai cron update tugas rutin amplifikasi (oprrequest) - lock acquired.',
  });

  try {
    const clients = await findAllActiveOrgAmplifyClients();
    if (!clients.length) {
      sendDebug({ tag: CRON_TAG, msg: 'Tidak ada client org aktif dengan amplifikasi aktif.' });
      return;
    }

    for (const client of clients) {
      try {
        await runUpdateForClient(client);
      } catch (err) {
        sendDebug({
          tag: CRON_TAG,
          msg: `[${client.client_id}] Gagal update tugas rutin: ${err.message || err}`,
        });
      }
    }
  } catch (err) {
    sendDebug({
      tag: CRON_TAG,
      msg: `[ERROR GLOBAL] ${err.message || err}`,
    });
  } finally {
    await distributedLock.release();
    sendDebug({
      tag: CRON_TAG,
      msg: 'Lock released',
    });
  }
}

scheduleCronJob(JOB_KEY, CRON_EXPRESSION, runCron, CRON_OPTIONS);

export default null;
