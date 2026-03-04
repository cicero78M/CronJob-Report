import { sendDebug } from '../middleware/debugHandler.js';
import { runDirRequestAction } from '../service/dirRequestService.js';
import { findClientById } from '../service/clientService.js';
import { splitRecipientField } from '../repository/clientContactRepository.js';
import {
  sendWithClientFallback,
  getAdminWAIds,
  normalizeUserWhatsAppId,
  minPhoneDigitLength,
  normalizeGroupId,
} from '../utils/waHelper.js';
import { getDirectorateWaRoute } from './waClientRouting.js';
import { delayAfterSend } from './dirRequestThrottle.js';
import { acquireDistributedLock } from '../service/distributedLockService.js';

const CLIENT_ID = 'DITINTELKAM';
export const JOB_KEY = './src/cron/cronDirRequestDitintelkamRoutine.js';
const DISTRIBUTED_LOCK_KEY = 'cron:dirrequest:ditintelkam-routine';
const CRON_MAX_RUN_MINUTES = 60;
const LOCK_TTL_SECONDS = (CRON_MAX_RUN_MINUTES + 5) * 60;
const CRON_LABEL = 'CRON DIRREQ DITINTELKAM RUTIN';
const MENUS = ['6', '9'];

const { primaryClient, reportClient, fallbackClients: waFallbackClients } = getDirectorateWaRoute();

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

const adminRecipients = new Set(
  getAdminWAIds().map((wid) => normalizeUserRecipient(wid)).filter(Boolean)
);

function toWAid(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('@g.us')) return trimmed;
  return normalizeUserRecipient(trimmed);
}

function buildRecipients(client) {
  const recipients = new Set();

  const groupRecipient = normalizeGroupId(client?.client_group);
  if (groupRecipient) {
    recipients.add(groupRecipient);
  }

  splitRecipientField(client?.client_operator).forEach((wa) => {
    const normalized = toWAid(wa);
    if (normalized) recipients.add(normalized);
  });

  splitRecipientField(client?.client_super).forEach((wa) => {
    const normalized = toWAid(wa);
    if (normalized) recipients.add(normalized);
  });

  return Array.from(recipients);
}

function shouldRunDitintelkam(client) {
  if (client?.client_status !== true) {
    return { shouldRun: false, reason: 'client_inactive' };
  }

  if (client?.client_insta_status !== true) {
    return { shouldRun: false, reason: 'instagram_inactive' };
  }

  if (client?.client_tiktok_status !== true) {
    return { shouldRun: false, reason: 'tiktok_inactive' };
  }

  return { shouldRun: true, reason: null };
}

function buildSkipMessage(client, reason) {
  return [
    `Skip DITINTELKAM rutin (reason=${reason})`,
    `client_status=${String(client?.client_status)}`,
    `client_insta_status=${String(client?.client_insta_status)}`,
    `client_tiktok_status=${String(client?.client_tiktok_status)}`,
  ].join(' | ');
}

async function logToAdmins(message) {
  if (!message || adminRecipients.size === 0) return;
  const prefix = '[CRON DIRREQ DITINTELKAM RUTIN] ';
  for (const admin of adminRecipients) {
    await sendWithClientFallback({
      chatId: admin,
      message: `${prefix}${message}`,
      clients: waFallbackClients,
      reportClient,
      reportContext: { jobKey: JOB_KEY, admin },
    });
  }
}

async function logPhase(message) {
  await logToAdmins(message);
  sendDebug({ tag: CRON_LABEL, msg: message });
}

async function executeMenus(recipients) {
  const failures = [];

  for (let recipientIndex = 0; recipientIndex < recipients.length; recipientIndex += 1) {
    const chatId = recipients[recipientIndex];

    for (let actionIndex = 0; actionIndex < MENUS.length; actionIndex += 1) {
      const action = MENUS[actionIndex];
      try {
        await logPhase(`Mulai jalankan menu ${action} untuk ${CLIENT_ID} -> ${chatId}`);
        await runDirRequestAction({
          action,
          clientId: CLIENT_ID,
          chatId,
          roleFlag: CLIENT_ID.toLowerCase(),
          userClientId: CLIENT_ID,
          waClient: primaryClient,
          fallbackClients: waFallbackClients,
          fallbackContext: {
            action,
            clientId: CLIENT_ID,
            chatId,
            jobKey: JOB_KEY,
          },
        });
        await logPhase(`Menu ${action} selesai untuk ${chatId}`);
      } catch (err) {
        const errorMsg = `Gagal menu ${action} untuk ${chatId}: ${err.message || err}`;
        failures.push(errorMsg);
        await logPhase(errorMsg);
      }

      const isLastRecipient = recipientIndex === recipients.length - 1;
      const isLastAction = actionIndex === MENUS.length - 1;
      if (!isLastRecipient || !isLastAction) {
        await delayAfterSend();
      }
    }
  }

  return failures;
}

export async function runCron() {
  const distributedLock = await acquireDistributedLock({
    key: DISTRIBUTED_LOCK_KEY,
    ttlSeconds: LOCK_TTL_SECONDS,
  });

  if (!distributedLock.acquired) {
    const skipMsg = `Lewati cron: lock sudah diambil oleh instance lain (${distributedLock.reason || 'lock_held'})`;
    sendDebug({ tag: CRON_LABEL, msg: skipMsg });
    await logToAdmins(skipMsg);
    return;
  }

  await logPhase('Mulai cron DITINTELKAM rutin (menu 6 & 9) - lock acquired');

  let sendStatus = 'pending';

  try {
    const client = await findClientById(CLIENT_ID);
    const runCheck = shouldRunDitintelkam(client);

    if (!runCheck.shouldRun) {
      sendStatus = buildSkipMessage(client, runCheck.reason);
      await logPhase(sendStatus);
      return;
    }

    const recipients = buildRecipients(client);

    if (recipients.length === 0) {
      sendStatus = 'tidak ada penerima valid untuk DITINTELKAM';
      await logToAdmins(sendStatus);
    } else {
      await logPhase(`Daftar penerima valid DITINTELKAM: ${recipients.join(', ')}`);
      const failures = await executeMenus(recipients);
      sendStatus =
        failures.length === 0
          ? `menu 6 dan 9 dikirim ke ${recipients.length} penerima`
          : `menu 6 dan 9 selesai dengan ${failures.length} kegagalan`;

      if (failures.length > 0) {
        await logToAdmins(`${sendStatus}\n${failures.join('\n')}`);
      }
    }
  } catch (err) {
    sendStatus = `gagal memproses DITINTELKAM: ${err.message || err}`;
    await logToAdmins(sendStatus);
  } finally {
    await distributedLock.release();
    await logPhase('Lock released');
    await logToAdmins(`Ringkasan: ${sendStatus}`);
    sendDebug({ tag: CRON_LABEL, msg: { sendStatus } });
  }
}

export default null;
