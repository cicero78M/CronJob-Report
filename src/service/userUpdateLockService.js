// src/service/userUpdateLockService.js
// Service to prevent concurrent user updates using Redis distributed locks

import redis from '../config/redis.js';

const LOCK_TTL_SEC = 10; // Lock expires after 10 seconds to prevent deadlocks
const LOCK_PREFIX = 'user_update_lock:';

/**
 * Acquire a distributed lock for user update operation
 * @param {string} userId - User ID to lock
 * @param {string} field - Field being updated (e.g., 'insta', 'tiktok')
 * @returns {Promise<boolean>} - True if lock acquired, false otherwise
 */
export async function acquireUpdateLock(userId, field) {
  const key = `${LOCK_PREFIX}${userId}:${field}`;
  try {
    // SET NX EX - Set if Not eXists with EXpiration
    const result = await redis.set(key, Date.now().toString(), {
      NX: true,
      EX: LOCK_TTL_SEC
    });
    return result === 'OK';
  } catch (error) {
    console.error('[USER UPDATE LOCK] Error acquiring lock:', error);
    return false;
  }
}

/**
 * Release a distributed lock for user update operation
 * @param {string} userId - User ID to unlock
 * @param {string} field - Field being updated
 * @returns {Promise<void>}
 */
export async function releaseUpdateLock(userId, field) {
  const key = `${LOCK_PREFIX}${userId}:${field}`;
  try {
    await redis.del(key);
  } catch (error) {
    console.error('[USER UPDATE LOCK] Error releasing lock:', error);
  }
}

/**
 * Check if a lock exists for a user update
 * @param {string} userId - User ID to check
 * @param {string} field - Field being updated
 * @returns {Promise<boolean>} - True if locked, false otherwise
 */
export async function isUpdateLocked(userId, field) {
  const key = `${LOCK_PREFIX}${userId}:${field}`;
  try {
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (error) {
    console.error('[USER UPDATE LOCK] Error checking lock:', error);
    return false;
  }
}

/**
 * Execute a user update with distributed lock
 * @param {string} userId - User ID
 * @param {string} field - Field to update
 * @param {Function} updateFn - Async function to execute update
 * @returns {Promise<any>} - Result from updateFn
 * @throws {Error} - If lock cannot be acquired or update fails
 */
export async function withUpdateLock(userId, field, updateFn) {
  const lockAcquired = await acquireUpdateLock(userId, field);
  
  if (!lockAcquired) {
    throw new Error('Operasi update sedang diproses. Silakan tunggu beberapa saat.');
  }
  
  try {
    const result = await updateFn();
    return result;
  } finally {
    await releaseUpdateLock(userId, field);
  }
}
