import './src/utils/logger.js';
// Note: Environment validation happens automatically through imports in services
import cronManifest from './src/cron/cronManifest.js';
import { registerDirRequestCrons } from './src/cron/dirRequest/index.js';
import { initializeWAService, waClient, waGatewayClient } from './src/service/waService.js';
import { startOtpWorker } from './src/service/otpQueue.js';

const cronBuckets = cronManifest.reduce((buckets, { bucket, modulePath }) => {
  if (!bucket || !modulePath) return buckets;
  if (!buckets[bucket]) buckets[bucket] = [];

  if (!buckets[bucket].includes(modulePath)) {
    buckets[bucket].push(modulePath);
  }

  return buckets;
}, { always: [], direktorat: [], operatorPolres: [] });

const loadedCronModules = new Set();

async function loadCronModules(modules = []) {
  const pendingModules = modules.filter(modulePath => !loadedCronModules.has(modulePath));
  if (!pendingModules.length) return false;

  await Promise.all(pendingModules.map(async modulePath => {
    await import(modulePath);
    loadedCronModules.add(modulePath);
    console.log(`[CRON] Activated ${modulePath}`);
  }));

  return true;
}

function logBucketStatus(label, activated) {
  const status = activated ? 'activated' : 'already active';
  console.log(`[CRON] ${label} cron bucket ${status}`);
}

function scheduleCronBucket(client, bucketKey, label) {
  const modules = cronBuckets[bucketKey] || [];
  if (!modules.length) return;

  const activateBucket = () =>
    loadCronModules(modules)
      .then(activated => logBucketStatus(label, activated))
      .catch(err => console.error(`[CRON] Failed to activate ${label} cron bucket`, err));

  // Listen for ready event in case client reconnects
  client.on('ready', () => {
    console.log(`[CRON] ${label} client ready event`);
    activateBucket();
  });

  if (client.isReady) {
    console.log(`[CRON] ${label} client confirmed ready`);
    activateBucket();
  } else {
    console.warn(`[CRON] ${label} client not ready; bucket will activate on recovery`);
  }
}

// Initialize WhatsApp clients with new architecture
async function initializeApp() {
  try {
    console.log('[APP] Initializing WhatsApp clients with new architecture...');
    
    // Initialize WA service and clients - MUST complete before any cron jobs run
    await initializeWAService();
    console.log('[APP] WhatsApp clients initialized and ready');
    
    // Load always bucket AFTER WA clients are initialized
    await loadCronModules(cronBuckets.always)
      .then(activated => logBucketStatus('Always', activated))
      .catch(err => console.error('[CRON] Failed to activate always cron bucket', err));

    // Always attach ready listeners. A client that recovers after partial
    // startup must be able to activate its own bucket without a PM2 restart.
    scheduleCronBucket(waClient, 'direktorat', 'WA direktorat');
    scheduleCronBucket(waGatewayClient, 'operatorPolres', 'WA operator polres');

    // These schedules send through wa-direktorat and must not depend on the
    // unrelated operator client being ready during startup.
    registerDirRequestCrons(waClient);

    // Start OTP worker
    await startOtpWorker().catch(err => console.error('[OTP] worker error', err));

    console.log('[APP] Cicero CronJob service started with WA sessions: direktorat & operator');
    console.log('[APP] Web endpoints and wabot menus removed');
    console.log('[APP] Only automated cron jobs and background workers are running');
  } catch (error) {
    console.error('[APP] Failed to initialize application:', error);
    process.exit(1);
  }
}

// Start the application
initializeApp();
