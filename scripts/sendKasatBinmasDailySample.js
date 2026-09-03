import { initializeWAService, getWAClient } from '../src/service/waService.js';
import { waService } from '../src/wa/compatibility.js';
import { normalizeUserWhatsAppId, minPhoneDigitLength } from '../src/utils/waHelper.js';
import { runDirRequestAction } from '../src/service/dirRequestService.js';

const recipient = normalizeUserWhatsAppId(process.argv[2], minPhoneDigitLength);
const requestedActions = (process.argv[3] || '34,35')
  .split(',')
  .map((action) => action.trim())
  .filter((action) => action === '34' || action === '35');
if (!recipient) {
  throw new Error('Nomor tujuan tidak valid. Gunakan format kode negara, contoh 628123456789.');
}
if (!requestedActions.length) {
  throw new Error('Menu tidak valid. Gunakan 34, 35, atau 34,35.');
}

let exitCode = 0;

try {
  const referenceDate = new Date();
  await initializeWAService();
  const waClient = getWAClient();
  await waClient.waitForWaReady(120000);

  for (const [index, action] of requestedActions.entries()) {
    await runDirRequestAction({
      action,
      clientId: 'DITBINMAS',
      chatId: recipient,
      roleFlag: 'DITBINMAS',
      userClientId: 'DITBINMAS',
      waClient,
      context: { period: 'daily', referenceDate },
    });
    console.log(`Menu ${action} berhasil dikirim ke ${recipient}.`);
    if (index < requestedActions.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }

  console.log(`Contoh laporan menu ${requestedActions.join('/')} terkirim ke ${recipient}.`);
} catch (error) {
  exitCode = 1;
  console.error('Gagal mengirim contoh laporan:', error);
} finally {
  await waService.destroy();
  process.exit(exitCode);
}
