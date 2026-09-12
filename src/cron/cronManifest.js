export default [
  {
    jobKey: './src/cron/cronRekapLink.js',
    modulePath: './src/cron/cronRekapLink.js',
    bucket: 'operatorPolres',
    affinity: 'operatorPolres',
    description: 'Distribute amplification link recaps to all active amplification clients.',
  },
  {
    jobKey: './src/cron/cronAmplifyLinkMonthly.js',
    modulePath: './src/cron/cronAmplifyLinkMonthly.js',
    bucket: 'operatorPolres',
    affinity: 'operatorPolres',
    description: 'Generate and deliver monthly amplification spreadsheets on the last day of the month.',
  },
  // Disabled by operator request: user insight and rekap update notifications.
  {
    jobKey: './src/cron/cronDashboardSubscriptionExpiry.js',
    modulePath: './src/cron/cronDashboardSubscriptionExpiry.js',
    bucket: 'direktorat',
    affinity: 'direktorat',
    description: 'Expire overdue dashboard subscriptions and notify users via WhatsApp.',
  },
  {
    jobKey: './src/cron/cronPremiumExpiry.js',
    modulePath: './src/cron/cronPremiumExpiry.js',
    bucket: 'always',
    affinity: 'platform',
    description: 'Expire premium access for mobile users when premium_end_date has passed.',
  },
  // Disabled by operator request: absensi update data personil/username notifications.
  {
    jobKey: './src/cron/cronOprRequestAbsensiEngagement.js',
    modulePath: './src/cron/cronOprRequestAbsensiEngagement.js',
    bucket: 'operatorPolres',
    affinity: 'operatorPolres',
    description: 'Send oprrequest engagement absensi Instagram/TikTok recaps to org client WhatsApp group, operator, and super admin.',
  },
  {
    jobKey: './src/cron/cronOprRequestAmplifyRoutineUpdate.js',
    modulePath: './src/cron/cronOprRequestAmplifyRoutineUpdate.js',
    bucket: 'always',
    affinity: 'platform',
    description: 'Refresh oprrequest tugas rutin amplification content for active org clients with amplification enabled during business hours.',
  },
  {
    jobKey: './src/cron/cronOprRequestDailyReport.js',
    modulePath: './src/cron/cronOprRequestDailyReport.js',
    bucket: 'operatorPolres',
    affinity: 'operatorPolres',
    description: 'Send separate oprrequest reports for official/routine tasks and special tasks, plus the existing routine yesterday report, to operator WhatsApp for active org clients with amplification enabled.',
  },
];
