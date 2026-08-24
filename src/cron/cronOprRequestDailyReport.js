// src/cron/cronOprRequestDailyReport.js

import { scheduleCronJob } from '../utils/cronScheduler.js';
import { sendDebug } from '../middleware/debugHandler.js';
import { waitForAllMessageQueues } from '../service/waService.js';
import { getOperatorWaRoute } from './waClientRouting.js';
import { findAllActiveOrgAmplifyClients } from '../model/clientModel.js';
import {
  generateDailyAmplificationReport,
  generateDailySpecialAmplificationReport,
  generateYesterdayAmplificationReport,
} from '../service/oprReportService.js';
import { normalizeUserWhatsAppId, minPhoneDigitLength } from '../utils/waHelper.js';
import { acquireDistributedLock } from '../service/distributedLockService.js';

export const JOB_KEY = './src/cron/cronOprRequestDailyReport.js';
const CRON_EXPRESSION = '7 21 * * *'; // Every day at 22:30 PM Jakarta time
const CRON_OPTIONS = { timezone: 'Asia/Jakarta' };
const CRON_TAG = 'CRON OPRREQUEST DAILY REPORT';
const DISTRIBUTED_LOCK_KEY = 'cron:oprrequest:daily-report';
const CRON_MAX_RUN_MINUTES = 30;
const LOCK_TTL_SECONDS = (CRON_MAX_RUN_MINUTES + 5) * 60;
const { primaryClient } = getOperatorWaRoute();

// Delay constants (in milliseconds)
const MESSAGE_DELAY_MS = 2000; // Delay between messages to the same recipient
const CLIENT_DELAY_MS = 3000; // Delay between processing different clients

/**
 * Normalize WhatsApp ID for recipient
 */
function normalizeUserRecipient(value) {
  const normalized = normalizeUserWhatsAppId(value, minPhoneDigitLength);
  if (!normalized) {
    console.warn('[SKIP WA] invalid recipient', value);
    return null;
  }
  return normalized;
}

/**
 * Convert to WhatsApp ID format
 */
function toWAid(id) {
  if (!id || typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('@g.us')) return trimmed;
  return normalizeUserRecipient(trimmed);
}

/**
 * Get WhatsApp operator recipient for a client
 * Returns the client_operator WhatsApp ID
 */
function getOperatorRecipient(client) {
  if (!client.client_operator) return null;
  return toWAid(client.client_operator);
}

/**
 * Send report to operator
 */
async function sendReportToOperator(client, reportMessage) {
  if (client?.client_status !== true) {
    sendDebug({
      tag: CRON_TAG,
      msg: `[${client?.client_id || 'UNKNOWN'}] Skip kirim laporan: client_status=${String(client?.client_status)}`,
    });
    return false;
  }

  const operatorWA = getOperatorRecipient(client);
  
  if (!operatorWA) {
    sendDebug({
      tag: CRON_TAG,
      msg: `[${client.client_id}] Tidak ada operator WhatsApp terdaftar`,
    });
    return false;
  }
  
  try {
    await primaryClient.sendMessage(operatorWA, reportMessage);
    sendDebug({
      tag: CRON_TAG,
      msg: `[${client.client_id}] Laporan berhasil dikirim ke operator ${operatorWA}`,
    });
    return true;
  } catch (err) {
    sendDebug({
      tag: CRON_TAG,
      msg: `[${client.client_id}] Gagal mengirim laporan ke operator: ${err.message}`,
    });
    return false;
  }
}

/**
 * Process daily reports for a single client
 */
async function processClientReports(client) {
  if (client?.client_status !== true) {
    sendDebug({
      tag: CRON_TAG,
      msg: `[${client?.client_id || 'UNKNOWN'}] Skip proses laporan: client_status=${String(client?.client_status)}`,
    });
    return;
  }

  sendDebug({
    tag: CRON_TAG,
    msg: `[${client.client_id}] Memproses laporan harian untuk ${client.nama}`,
  });
  
  const generateAndSend = async (label, generator, { delayAfter = false } = {}) => {
    try {
      const report = await generator(client.client_id);
      if (!report) {
        sendDebug({ tag: CRON_TAG, msg: `[${client.client_id}] Tidak ada data ${label}` });
        return;
      }
      await sendReportToOperator(client, report);
      if (delayAfter) {
        await new Promise((resolve) => setTimeout(resolve, MESSAGE_DELAY_MS));
      }
    } catch (err) {
      // Setiap jenis laporan independen: kegagalan satu laporan tidak boleh
      // menghentikan pengiriman jenis laporan berikutnya.
      sendDebug({
        tag: CRON_TAG,
        msg: `[${client.client_id}] Gagal memproses ${label}: ${err.message || err}`,
      });
    }
  };

  await generateAndSend('laporan reguler hari ini', generateDailyAmplificationReport, {
    delayAfter: true,
  });
  await generateAndSend('laporan khusus hari ini', generateDailySpecialAmplificationReport, {
    delayAfter: true,
  });
  // Pertahankan laporan rutin kemarin sebagai proses bisnis yang sudah ada.
  await generateAndSend('laporan reguler kemarin', generateYesterdayAmplificationReport);
}

/**
 * Main cron job function
 */
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
    msg: 'Mulai cron laporan harian amplifikasi (oprrequest) - lock acquired',
  });
  
  try {
    // Get all active org clients with amplification enabled
    const clients = await findAllActiveOrgAmplifyClients();
    
    if (!clients.length) {
      sendDebug({
        tag: CRON_TAG,
        msg: 'Tidak ada client org aktif dengan amplifikasi aktif',
      });
      return;
    }
    
    sendDebug({
      tag: CRON_TAG,
      msg: `Ditemukan ${clients.length} client aktif dengan amplifikasi`,
    });
    
    // Process each client sequentially
    for (const client of clients) {
      await processClientReports(client);
      // Add delay between clients to avoid overwhelming WhatsApp
      await new Promise((resolve) => setTimeout(resolve, CLIENT_DELAY_MS));
    }
    
    sendDebug({
      tag: CRON_TAG,
      msg: 'Selesai memproses semua laporan harian',
    });
    
    // Wait for all message queues to be fully drained before completing
    sendDebug({
      tag: CRON_TAG,
      msg: 'Menunggu semua pesan selesai terkirim...',
    });
    await waitForAllMessageQueues();
    
    sendDebug({
      tag: CRON_TAG,
      msg: 'Semua pesan telah terkirim, cron selesai',
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
