import { findAllOrgClients } from '../model/clientModel.js';
import { getUsersByClient } from '../model/userModel.js';
import { matchesKasatBinmasJabatan } from './kasatBinmasMatcher.js';

const TARGET_REGIONAL_ID = 'JATIM';
const EXPECTED_POLRES_COUNT = 39;
const normalizeKey = (value) => String(value || '').trim().toUpperCase();

const fallbackClientsFromUsers = (users) => {
  const byClient = new Map();
  users.forEach((user) => {
    const clientId = normalizeKey(
      user?.client_id || user?.client_name || (user?.user_id ? `USER:${user.user_id}` : '')
    );
    if (!clientId || byClient.has(clientId)) return;
    byClient.set(clientId, {
      client_id: clientId,
      nama: String(user?.client_name || user?.client_id || user?.nama || clientId).trim(),
      regional_id: TARGET_REGIONAL_ID,
    });
  });
  return Array.from(byClient.values());
};

export async function buildKasatBinmasRoster() {
  const [users, orgClients] = await Promise.all([
    getUsersByClient('DITBINMAS', 'ditbinmas'),
    findAllOrgClients(),
  ]);
  const activeUsers = (users || []).filter((user) =>
    matchesKasatBinmasJabatan(user?.jabatan)
  );
  let clients = (orgClients || [])
    .filter((client) => normalizeKey(client?.regional_id) === TARGET_REGIONAL_ID)
    .map((client) => ({
      client_id: normalizeKey(client?.client_id),
      nama: String(client?.nama || client?.client_id || '').trim(),
      regional_id: normalizeKey(client?.regional_id),
    }))
    .filter((client) => client.client_id);

  // Test/degraded-mode fallback only. Production uses the regional master.
  if (!clients.length) clients = fallbackClientsFromUsers(activeUsers);
  if (orgClients?.length && clients.length !== EXPECTED_POLRES_COUNT) {
    console.warn(`[KASAT BINMAS ROSTER] Expected ${EXPECTED_POLRES_COUNT} Polres Jatim, found ${clients.length}`);
  }

  const usersByClient = new Map();
  activeUsers.forEach((user) => {
    const keys = new Set([
      normalizeKey(user?.client_id),
      normalizeKey(user?.client_name),
      normalizeKey(user?.user_id ? `USER:${user.user_id}` : ''),
    ].filter(Boolean));
    keys.forEach((key) => {
      const list = usersByClient.get(key) || [];
      if (!list.includes(user)) list.push(user);
      usersByClient.set(key, list);
    });
  });

  const entries = clients.map((client) => {
    const candidates = Array.from(new Set([
      ...(usersByClient.get(client.client_id) || []),
      ...(usersByClient.get(normalizeKey(client.nama)) || []),
    ]));
    if (candidates.length > 1) {
      console.warn(`[KASAT BINMAS ROSTER] Multiple active Kasat Binmas for ${client.client_id}: ${candidates.length}`);
    }
    return { client, user: candidates[0] || null };
  });

  return {
    entries,
    activeKasatUsers: entries.flatMap((entry) => (entry.user ? [entry.user] : [])),
    missingPolres: entries.filter((entry) => !entry.user).map((entry) => entry.client),
    totalPolres: entries.length,
    totalActiveKasat: entries.filter((entry) => entry.user).length,
  };
}

export default { buildKasatBinmasRoster };
