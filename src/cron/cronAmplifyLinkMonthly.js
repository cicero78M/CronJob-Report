import { scheduleCronJob } from '../utils/cronScheduler.js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { getOperatorWaRoute } from './waClientRouting.js';
import { sendDebug } from '../middleware/debugHandler.js';
import { saveLinkReportExcel } from '../service/linkReportExcelService.js';
import { formatToWhatsAppId, sendWAFile } from '../utils/waHelper.js';
import { getReportsThisMonthByClient } from '../model/linkReportModel.js';
import { acquireDistributedLock } from '../service/distributedLockService.js';

const { primaryClient } = getOperatorWaRoute();

dotenv.config();

const JOB_KEY = './src/cron/cronAmplifyLinkMonthly.js';
const CRON_TAG = 'CRON AMPLIFY';
const DISTRIBUTED_LOCK_KEY = 'cron:amplify-link-monthly';
const CRON_MAX_RUN_MINUTES = 60;
const LOCK_TTL_SECONDS = (CRON_MAX_RUN_MINUTES + 5) * 60;
const CLIENT_DELAY_MS = 3000;

async function getActiveClients() {
  const { query } = await import('../db/index.js');
  const res = await query(
    `SELECT client_id, nama, client_operator
       FROM clients
       WHERE client_status=true AND client_amplify_status=true
       ORDER BY client_id`
  );
  return res.rows;
}

function getJakartaDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
}

function isLastDayOfMonth() {
  const now = getJakartaDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return tomorrow.getDate() === 1;
}

async function runCron() {
  if (!isLastDayOfMonth()) return;

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

  sendDebug({ tag: CRON_TAG, msg: 'Mulai rekap link bulanan - lock acquired' });
  
  try {
    const clients = await getActiveClients();
    if (!clients.length) {
      sendDebug({ tag: CRON_TAG, msg: 'Tidak ada client aktif untuk diproses.' });
      return;
    }

    sendDebug({ tag: CRON_TAG, msg: `Memproses ${clients.length} client aktif` });

    let processedCount = 0;
    let errorCount = 0;

    for (const client of clients) {
      try {
        const rows = await getReportsThisMonthByClient(client.client_id);
        const monthName = getJakartaDate().toLocaleString('id-ID', {
          month: 'long',
          timeZone: 'Asia/Jakarta'
        });
        const filePath = await saveLinkReportExcel(
          rows,
          client.client_id,
          monthName
        );
        const buffer = await fs.readFile(filePath);
        const target = client.client_operator
          ? formatToWhatsAppId(client.client_operator)
          : null;
        if (target) {
          await sendWAFile(primaryClient, buffer, path.basename(filePath), target);
          sendDebug({
            tag: CRON_TAG,
            msg: `[${client.client_id}] File dikirim ke operator`
          });
          processedCount++;
        } else {
          sendDebug({
            tag: CRON_TAG,
            msg: `[${client.client_id}] Nomor operator tidak valid`
          });
        }
        await fs.unlink(filePath).catch(() => {});

        // Add delay between clients to avoid overwhelming WhatsApp
        if (client !== clients[clients.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, CLIENT_DELAY_MS));
        }
      } catch (err) {
        errorCount++;
        sendDebug({
          tag: CRON_TAG,
          msg: `[${client.client_id}] ERROR: ${err.message}`
        });
        // Continue to next client even if this one fails
      }
    }

    sendDebug({
      tag: CRON_TAG,
      msg: `Cron selesai: ${processedCount} berhasil, ${errorCount} gagal dari ${clients.length} client`,
    });
  } catch (err) {
    sendDebug({ tag: CRON_TAG, msg: `[ERROR GLOBAL] ${err.message || err}` });
  } finally {
    await distributedLock.release();
    sendDebug({ tag: CRON_TAG, msg: 'Lock released' });
  }
}

scheduleCronJob(JOB_KEY, '0 23 28-31 * *', runCron, { timezone: 'Asia/Jakarta' });

export default null;
