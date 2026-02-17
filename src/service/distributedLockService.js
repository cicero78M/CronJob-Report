import redis from '../config/redis.js';

const LOCK_RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * Acquire distributed lock in Redis using NX+EX semantics.
 * Prevents race conditions when multiple instances try to run the same cronjob.
 * @param {object} options
 * @param {string} options.key - Lock key (e.g., 'cron:oprrequest:absensi-engagement')
 * @param {number} options.ttlSeconds - Lock TTL in seconds
 * @param {string} [options.ownerId] - Optional owner ID (defaults to process PID + timestamp)
 * @returns {Promise<{acquired: boolean, key: string, ownerId: string, release: () => Promise<void>, reason?: string}>}
 */
export async function acquireDistributedLock({ key, ttlSeconds, ownerId }) {
  const lockOwnerId =
    ownerId || `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

  try {
    const result = await redis.set(key, lockOwnerId, {
      NX: true,
      EX: ttlSeconds,
    });

    if (result !== 'OK') {
      return {
        acquired: false,
        key,
        ownerId: lockOwnerId,
        release: async () => {},
        reason: 'lock_held',
      };
    }

    return {
      acquired: true,
      key,
      ownerId: lockOwnerId,
      release: async () => {
        try {
          await redis.eval(LOCK_RELEASE_SCRIPT, {
            keys: [key],
            arguments: [lockOwnerId],
          });
        } catch (err) {
          console.error(
            `[distributedLockService] Failed to release lock key=${key}:`,
            err?.message || err
          );
        }
      },
    };
  } catch (error) {
    console.error(
      `[distributedLockService] Failed to acquire lock key=${key}:`,
      error?.message || error
    );
    return {
      acquired: false,
      key,
      ownerId: lockOwnerId,
      release: async () => {},
      reason: 'lock_error',
    };
  }
}
