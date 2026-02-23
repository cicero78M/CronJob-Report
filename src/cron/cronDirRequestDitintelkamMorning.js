import { sendDebug } from '../middleware/debugHandler.js';
import { runDirRequestAction } from '../service/dirRequestService.js';
import { findClientById } from '../service/clientService.js';
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
export const JOB_KEY = './src/cron/cronDirRequestDitintelkamMorning.js';
const DISTRIBUTED_LOCK_KEY = 'cron:dirrequest:ditintelkam-morning';
const CRON_MAX_RUN_MINUTES = 30;
const LOCK_TTL_SECONDS = (CRON_MAX_RUN_MINUTES + 5) * 60;
const CRON_LABEL = 'CRON DIRREQ DITINTELKAM 07:10';
const DEFAULT_MENUS = ['1'];
const NIGHT_MENUS = ['1', '2', '3'];

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

async function logToAdmins(message) {
  if (!message || adminRecipients.size === 0) return;
  const prefix = '[CRON DIRREQ DITINTELKAM 07:10] ';
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

function getGroupRecipient(client) {
  return normalizeGroupId(client?.client_group);
}

async function executeMenusForRecipient(chatId, menus) {
  const failures = [];

  for (let index = 0; index < menus.length; index += 1) {
    const action = menus[index];
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

    if (index < menus.length - 1) {
      await delayAfterSend();
    }
  }

  return failures;
}

async function runCronWithMenus(menus, runLabel) {
  const distributedLock = await acquireDistributedLock({
    key: `${DISTRIBUTED_LOCK_KEY}:${runLabel}`,
    ttlSeconds: LOCK_TTL_SECONDS,
  });

  if (!distributedLock.acquired) {
    const skipMsg = `Lewati cron: lock sudah diambil oleh instance lain (${distributedLock.reason || 'lock_held'})`;
    sendDebug({ tag: CRON_LABEL, msg: skipMsg });
    await logToAdmins(skipMsg);
    return;
  }

  await logPhase(`Mulai cron DITINTELKAM ${runLabel} (menu ${menus.join(', ')}) - lock acquired`);

  let sendStatus = 'pending';

  try {
    const client = await findClientById(CLIENT_ID);
    const groupRecipient = getGroupRecipient(client);

    if (!groupRecipient) {
      sendStatus = 'tidak ada group penerima valid untuk DITINTELKAM';
      await logToAdmins(sendStatus);
    } else {
      const failures = await executeMenusForRecipient(groupRecipient, menus);
      sendStatus =
        failures.length === 0
          ? `menu ${menus.join(', ')} dikirim ke group ${groupRecipient}`
          : `menu ${menus.join(', ')} selesai dengan ${failures.length} kegagalan`;

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
  }

  await logToAdmins(`Ringkasan: ${sendStatus}`);
  sendDebug({ tag: CRON_LABEL, msg: { sendStatus } });
}

export async function runCron() {
  return runCronWithMenus(DEFAULT_MENUS, 'pagi/siang');
}

export async function runCronAt2202() {
  return runCronWithMenus(NIGHT_MENUS, '22.02 (chakranarayana jajaran 2 & 3)');
}

export default null;
