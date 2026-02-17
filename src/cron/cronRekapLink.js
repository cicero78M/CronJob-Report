import { scheduleCronJob } from "../utils/cronScheduler.js";
import dotenv from "dotenv";
dotenv.config();

import { getOperatorWaRoute } from "./waClientRouting.js";
import { sendDebug } from "../middleware/debugHandler.js";
import { normalizeUserWhatsAppId, minPhoneDigitLength, sendWithClientFallback } from "../utils/waHelper.js";
import { acquireDistributedLock } from "../service/distributedLockService.js";

import { absensiLink } from "../handler/fetchabsensi/link/absensiLinkAmplifikasi.js";

const { primaryClient, fallbackClients } = getOperatorWaRoute();

async function getActiveClients() {
  const { query } = await import("../db/index.js");
  const rows = await query(
    `SELECT client_id, nama, client_operator, client_super, client_group
     FROM clients
     WHERE client_status=true AND client_amplify_status=true
       AND LOWER(client_type)='org'
     ORDER BY client_id`
  );
  return rows.rows;
}

function logInvalidRecipient(value) {
  console.warn("[SKIP WA] invalid recipient", value);
}

function normalizeUserRecipient(value) {
  const normalized = normalizeUserWhatsAppId(value, minPhoneDigitLength);
  if (!normalized) {
    logInvalidRecipient(value);
    return null;
  }
  return normalized;
}

function toWAid(id) {
  if (!id || typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("@g.us")) return trimmed;
  return normalizeUserRecipient(trimmed);
}

function getAdminWAIds() {
  return (process.env.ADMIN_WHATSAPP || "")
    .split(",")
    .map(n => n.trim())
    .filter(Boolean)
    .map(toWAid)
    .filter(Boolean);
}

function getRecipients(client) {
  const result = new Set();
  getAdminWAIds().forEach(n => result.add(n));
  [client.client_operator, client.client_super, client.client_group]
    .map(toWAid)
    .filter(Boolean)
    .forEach(n => result.add(n));
  return Array.from(result);
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

  sendDebug({ tag: CRON_TAG, msg: "Mulai rekap link harian - lock acquired" });
  
  try {
    const clients = await getActiveClients();
    if (!clients.length) {
      sendDebug({ tag: CRON_TAG, msg: 'Tidak ada client org aktif untuk diproses.' });
      return;
    }

    sendDebug({ tag: CRON_TAG, msg: `Memproses ${clients.length} client org aktif` });

    let processedCount = 0;
    let errorCount = 0;

    for (const client of clients) {
      try {
        const msg = await absensiLink(client.client_id, { roleFlag: "operator" });
        const targets = getRecipients(client);
        
        let sentCount = 0;
        let failedCount = 0;

        for (let i = 0; i < targets.length; i++) {
          const wa = targets[i];
          try {
            const success = await sendWithClientFallback({
              chatId: wa,
              message: msg,
              clients: fallbackClients,
              reportClient: primaryClient,
              reportContext: {
                jobKey: JOB_KEY,
                clientId: client.client_id,
                chatId: wa,
                menu: 'rekap-link',
              },
            });

            if (success) {
              sentCount++;
            } else {
              failedCount++;
            }

            // Add delay between messages to avoid race conditions
            if (i < targets.length - 1) {
              await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));
            }
          } catch (err) {
            failedCount++;
            sendDebug({
              tag: CRON_TAG,
              msg: `[${client.client_id}] Gagal kirim ke ${wa}: ${err.message || err}`,
            });
          }
        }

        sendDebug({
          tag: CRON_TAG,
          msg: `[${client.client_id}] Rekap link selesai: ${sentCount} berhasil, ${failedCount} gagal dari ${targets.length} penerima`,
        });

        processedCount++;
      } catch (err) {
        errorCount++;
        sendDebug({
          tag: CRON_TAG,
          msg: `[${client.client_id}] ERROR absensi link: ${err.message}`,
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
    sendDebug({ tag: CRON_TAG, msg: "Lock released" });
  }
}

const JOB_KEY = "./src/cron/cronRekapLink.js";
const CRON_TAG = "CRON LINK";
const DISTRIBUTED_LOCK_KEY = "cron:rekap-link";
const CRON_MAX_RUN_MINUTES = 30;
const LOCK_TTL_SECONDS = (CRON_MAX_RUN_MINUTES + 5) * 60;
const MESSAGE_DELAY_MS = 2000;

scheduleCronJob(JOB_KEY, "5 15,18,21 * * *", runCron, { timezone: "Asia/Jakarta" });
export { getActiveClients, getRecipients };

export default null;
