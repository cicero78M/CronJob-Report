import { scheduleCronJob } from '../utils/cronScheduler.js';
import { sendDebug } from '../middleware/debugHandler.js';
import { absensiLikes } from '../handler/fetchabsensi/insta/absensiLikesInsta.js';
import { absensiKomentar } from '../handler/fetchabsensi/tiktok/absensiKomentarTiktok.js';
import {
  minPhoneDigitLength,
  normalizeUserWhatsAppId,
  sendWithClientFallback,
  normalizeGroupId,
} from '../utils/waHelper.js';
import { getOperatorWaRoute } from './waClientRouting.js';
import { acquireDistributedLock } from '../service/distributedLockService.js';

export const JOB_KEY = './src/cron/cronOprRequestAbsensiEngagement.js';
const CRON_EXPRESSION = '20 15,18,20 * * *';
const CRON_OPTIONS = { timezone: 'Asia/Jakarta' };
const CRON_TAG = 'CRON OPRREQUEST ABSENSI ENGAGEMENT';
const ROLE_FLAG = 'operator';
const ABSENSI_MODE = 'all';
const DISTRIBUTED_LOCK_KEY = 'cron:oprrequest:absensi-engagement';
const CRON_MAX_RUN_MINUTES = 30;
const LOCK_TTL_SECONDS = (CRON_MAX_RUN_MINUTES + 5) * 60;
const MESSAGE_DELAY_MS = 2000;

const { reportClient, fallbackClients: waFallbackClients } = getOperatorWaRoute();

async function getActiveClients() {
  const { query } = await import('../db/index.js');
  const rows = await query(
    `SELECT client_id, nama, client_operator, client_super, client_group
     FROM clients
     WHERE client_status=true
       AND LOWER(client_type)='org'
       AND client_insta_status=true
       AND client_tiktok_status=true
     ORDER BY client_id`
  );
  return rows.rows;
}

function logInvalidRecipient(value) {
  console.warn('[SKIP WA] invalid recipient', value);
}

function normalizeUserRecipient(value) {
  const normalized = normalizeUserWhatsAppId(value, minPhoneDigitLength);
  if (!normalized) {
    logInvalidRecipient(value);
    return null;
  }
  return normalized;
}

function getRecipients(client) {
  const result = new Set();
  const groupId = normalizeGroupId(client?.client_group);
  if (groupId) {
    result.add(groupId);
  }

  [client?.client_operator, client?.client_super]
    .map(normalizeUserRecipient)
    .filter(Boolean)
    .forEach((recipient) => result.add(recipient));

  return Array.from(result);
}

async function sendReport({ client, recipients, label, message }) {
  if (!recipients.length) {
    sendDebug({
      tag: CRON_TAG,
      msg: `[${client.client_id}] Lewati absensi ${label}: penerima WA belum terdaftar`,
    });
    return;
  }

  const content = message || 'Data tidak ditemukan.';
  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const chatId = recipients[i];
    try {
      const success = await sendWithClientFallback({
        chatId,
        message: content,
        clients: waFallbackClients,
        reportClient,
        reportContext: {
          jobKey: JOB_KEY,
          clientId: client.client_id,
          chatId,
          menu: `oprrequest-absensi-engagement-${label}`,
        },
      });

      if (success) {
        sentCount++;
      } else {
        failedCount++;
      }

      // Add delay between messages to avoid race conditions
      if (i < recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));
      }
    } catch (err) {
      failedCount++;
      sendDebug({
        tag: CRON_TAG,
        msg: `[${client.client_id}] Gagal kirim ${label} ke ${chatId}: ${err.message || err}`,
      });
    }
  }

  sendDebug({
    tag: CRON_TAG,
    msg: `[${client.client_id}] Absensi ${label} selesai: ${sentCount} berhasil, ${failedCount} gagal dari ${recipients.length} penerima`,
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
    msg: 'Mulai cron absensi engagement Instagram & TikTok (oprrequest) - lock acquired',
  });

  try {
    const clients = await getActiveClients();
    if (!clients.length) {
      sendDebug({ tag: CRON_TAG, msg: 'Tidak ada client org aktif untuk diproses.' });
      return;
    }

    sendDebug({
      tag: CRON_TAG,
      msg: `Memproses ${clients.length} client org aktif`,
    });

    let processedCount = 0;
    let errorCount = 0;

    for (const client of clients) {
      const recipients = getRecipients(client);
      try {
        const instagramReport = await absensiLikes(client.client_id, {
          mode: ABSENSI_MODE,
          roleFlag: ROLE_FLAG,
        });
        await sendReport({
          client,
          recipients,
          label: 'engagement-instagram',
          message: instagramReport,
        });

        const tiktokReport = await absensiKomentar(client.client_id, {
          mode: ABSENSI_MODE,
          roleFlag: ROLE_FLAG,
        });
        await sendReport({
          client,
          recipients,
          label: 'engagement-tiktok',
          message: tiktokReport,
        });

        processedCount++;
      } catch (err) {
        errorCount++;
        sendDebug({
          tag: CRON_TAG,
          msg: `[${client.client_id}] Gagal kirim absensi engagement: ${err.message || err}`,
        });
        // Continue to next client even if this one fails
      }
    }

    sendDebug({
      tag: CRON_TAG,
      msg: `Cron selesai: ${processedCount} berhasil, ${errorCount} gagal dari ${clients.length} client`,
    });
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
