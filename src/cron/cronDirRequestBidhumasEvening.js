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

const BIDHUMAS_CLIENT_ID = 'BIDHUMAS';
export const JOB_KEY = './src/cron/cronDirRequestBidhumasEvening.js';
const DISTRIBUTED_LOCK_KEY = 'cron:dirrequest:bidhumas-evening';
const CRON_MAX_RUN_MINUTES = 60;
const LOCK_TTL_SECONDS = (CRON_MAX_RUN_MINUTES + 5) * 60;

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
const CRON_LABEL = 'CRON DIRREQ BIDHUMAS 22:00';
const { primaryClient, reportClient, fallbackClients: waFallbackClients } = getDirectorateWaRoute();

function toWAid(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('@g.us')) return trimmed;
  return normalizeUserRecipient(trimmed);
}

function getGroupRecipient(client) {
  return normalizeGroupId(client?.client_group);
}

function getSuperAdminRecipients(client) {
  return splitRecipientField(client?.client_super).map(toWAid).filter(Boolean);
}

function buildRecipients(client) {
  const recipients = new Set();
  const groupId = getGroupRecipient(client);
  if (groupId) {
    recipients.add(groupId);
  }
  getSuperAdminRecipients(client).forEach((wa) => recipients.add(wa));
  return Array.from(recipients);
}

async function logToAdmins(message) {
  if (!message || adminRecipients.size === 0) return;
  const prefix = '[CRON DIRREQ BIDHUMAS 22:00] ';
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

async function executeBidhumasMenus(recipients) {
  const actions = [
    { action: '6' },
    { action: '9' },
    { action: '28', context: { period: 'today' } },
    { action: '29', context: { period: 'today' } },
  ];
  const failures = [];

  for (let recipientIndex = 0; recipientIndex < recipients.length; recipientIndex += 1) {
    const chatId = recipients[recipientIndex];

    for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
      const { action, context } = actions[actionIndex];
      try {
        await logPhase(`Mulai jalankan menu ${action} untuk BIDHUMAS -> ${chatId}`);
        await runDirRequestAction({
          action,
          clientId: BIDHUMAS_CLIENT_ID,
          chatId,
          roleFlag: BIDHUMAS_CLIENT_ID.toLowerCase(),
          userClientId: BIDHUMAS_CLIENT_ID,
          waClient: primaryClient,
          context,
          fallbackClients: waFallbackClients,
          fallbackContext: {
            action,
            clientId: BIDHUMAS_CLIENT_ID,
            chatId,
            jobKey: JOB_KEY,
            context,
          },
        });
        await logPhase(`Menu ${action} selesai untuk ${chatId}`);
      } catch (err) {
        const errorMsg = `Gagal menu ${action} untuk ${chatId}: ${err.message || err}`;
        failures.push(errorMsg);
        await logPhase(errorMsg);
      }

      const isLastRecipient = recipientIndex === recipients.length - 1;
      const isLastAction = actionIndex === actions.length - 1;
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

  await logPhase('Mulai cron BIDHUMAS malam: tanpa fetch sosmed - lock acquired');

  let sendStatus = 'pending';

  try {
    await logPhase('Ambil data BIDHUMAS dan daftar penerima WA');
    const client = await findClientById(BIDHUMAS_CLIENT_ID);
    const recipients = buildRecipients(client);

    if (recipients.length === 0) {
      sendStatus = 'tidak ada penerima valid untuk BIDHUMAS';
      await logToAdmins(sendStatus);
    } else {
      await logPhase(`Daftar penerima valid BIDHUMAS: ${recipients.join(', ')}`);
      const failures = await executeBidhumasMenus(recipients);
      sendStatus =
        failures.length === 0
          ? `menu 6, 9, 28, dan 29 dikirim ke ${recipients.length} penerima`
          : `menu 6, 9, 28, dan 29 selesai dengan ${failures.length} kegagalan`;

      if (failures.length > 0) {
        await logToAdmins(`${sendStatus}\n${failures.join('\n')}`);
      }
    }
  } catch (err) {
    sendStatus = `gagal memproses BIDHUMAS: ${err.message || err}`;
    await logToAdmins(sendStatus);
  } finally {
    await distributedLock.release();
    await logPhase('Lock released');
  }

  await logToAdmins(`Ringkasan: ${sendStatus}`);
  sendDebug({ tag: CRON_LABEL, msg: { sendStatus } });
}

export default null;
