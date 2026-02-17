// Cron removed: dashboard premium request expiry notifications are no longer scheduled.
// This module is intentionally kept as a no-op placeholder for backward compatibility.

export const JOB_KEY = './src/cron/cronDashboardPremiumRequestExpiry.js';

export async function runCron() {
  return null;
}

export default null;
