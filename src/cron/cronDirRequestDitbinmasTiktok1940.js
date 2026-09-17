import { sendDebug } from '../middleware/debugHandler.js';
import { runDirRequestAction } from '../service/dirRequestService.js';
import {
  minPhoneDigitLength,
  normalizeUserWhatsAppId,
} from '../utils/waHelper.js';
import { getDirectorateWaRoute } from './waClientRouting.js';
import { delayAfterSend } from './dirRequestThrottle.js';

const DITBINMAS_CLIENT_ID = 'DITBINMAS';
const TARGET_RECIPIENT = '+6281235114745';
export const JOB_KEY = './src/cron/cronDirRequestDitbinmasTiktok1940.js';
const CRON_LABEL = 'CRON DIRREQ DITBINMAS TIKTOK 19:40';
const ACTIONS = ['5', '6', '9', '10', '34', '35'];
const { primaryClient, fallbackClients: waFallbackClients } = getDirectorateWaRoute();

function normalizeRecipient(value) {
  return value ? normalizeUserWhatsAppId(value, minPhoneDigitLength) : null;
}

export async function runCron(referenceDate = new Date()) {
  const recipient = normalizeRecipient(TARGET_RECIPIENT);
  if (!recipient) {
    sendDebug({ tag: CRON_LABEL, msg: 'Nomor penerima tidak valid.' });
    return;
  }

  sendDebug({
    tag: CRON_LABEL,
    msg: `Mulai menu ${ACTIONS.join(', ')} untuk ${recipient} (data hari ini).`,
  });
  const failures = [];

  for (let index = 0; index < ACTIONS.length; index += 1) {
    const action = ACTIONS[index];
    try {
      await runDirRequestAction({
        action,
        clientId: DITBINMAS_CLIENT_ID,
        chatId: recipient,
        roleFlag: DITBINMAS_CLIENT_ID,
        userClientId: DITBINMAS_CLIENT_ID,
        context: { period: 'daily', referenceDate },
        waClient: primaryClient,
        fallbackClients: waFallbackClients,
        fallbackContext: {
          action,
          clientId: DITBINMAS_CLIENT_ID,
          chatId: recipient,
          jobKey: JOB_KEY,
          context: { period: 'daily', referenceDate },
        },
      });
      sendDebug({ tag: CRON_LABEL, msg: `Menu ${action} selesai untuk ${recipient}.` });
    } catch (error) {
      const message = `Menu ${action} gagal: ${error?.message || error}`;
      failures.push(message);
      sendDebug({ tag: CRON_LABEL, msg: message });
    }

    if (index < ACTIONS.length - 1) {
      await delayAfterSend();
    }
  }

  sendDebug({
    tag: CRON_LABEL,
    msg: failures.length
      ? `Selesai dengan ${failures.length} kegagalan untuk ${recipient}.`
      : `Semua menu ${ACTIONS.join(', ')} berhasil dikirim ke ${recipient}.`,
  });
}

export default null;
