-- Remove deprecated cron jobs from runtime configuration
DELETE FROM cron_job_config
WHERE job_key IN (
  './src/cron/cronDbBackup.js',
  './src/cron/cronDashboardPremiumRequestExpiry.js'
);
