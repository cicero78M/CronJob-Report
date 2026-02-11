import { absensiRegistrasiDashboardDirektorat } from '../handler/fetchabsensi/dashboard/absensiRegistrasiDashboardDirektorat.js';
import { sendWAReport, getAdminWAIds } from '../utils/waHelper.js';
import { getOperatorWaRoute } from './waClientRouting.js';
import { findAllActiveDirektorat } from '../model/clientModel.js';

const { primaryClient } = getOperatorWaRoute();

function formatDirectorateIds(clients = []) {
  return clients
    .map((client) => String(client.client_id || '').trim().toUpperCase())
    .filter(Boolean);
}

export async function runCron() {
  const directorateClients = await findAllActiveDirektorat();
  const directorateIds = formatDirectorateIds(directorateClients);
  const targets = getAdminWAIds();

  for (const dirId of directorateIds) {
    const msg = await absensiRegistrasiDashboardDirektorat(dirId);
    await sendWAReport(primaryClient, msg, targets);
  }
}

export default { runCron };
