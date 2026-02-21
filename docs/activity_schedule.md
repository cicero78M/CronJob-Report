# System Activity Schedule
*Last updated: 2026-02-11*

This document summarizes the automated jobs ("activity") that run inside Cicero_V2. All jobs use `node-cron`, are registered from `src/cron/*.js` during `app.js` boot, and execute in the **Asia/Jakarta** timezone unless stated otherwise. Base jobs now dipetakan ke afiliasi cron **direktorat** dan **operator polres** melalui `src/cron/cronManifest.js`, sementara job Ditbinmas (dirRequest) tetap dikelola dalam `src/cron/dirRequest/index.js` untuk toggle grup saat diperlukan.

## Runtime safeguards & configuration sync

Every cron file calls `scheduleCronJob`, which delegates to `src/utils/cronScheduler.js`. Before executing a handler, the scheduler fetches the matching record in `cron_job_config`; the job runs only when `is_active=true` so operations can toggle tasks safely without redeploying. The scheduler now retries the lookup once and logs errors before falling back to running the handler if configuration is unavailable, while still honoring `is_active=false` whenever the lookup succeeds. During prolonged database outages, disabled jobs may temporarily run because the safety check cannot be read—monitor `[CRON] Failed to check status...` logs to spot this scenario. The dirRequest group adds a higher-level toggle through `ENABLE_DIRREQUEST_GROUP` to pause all Ditbinmas schedules at once.【F:src/utils/cronScheduler.js†L1-L73】【F:src/cron/dirRequest/index.js†L1-L92】

The configuration data lives in the migration `sql/migrations/20251022_create_cron_job_config.sql` and is surfaced in the cron configuration menu, keeping this schedule synchronized with the controls that ops staff use to enable or pause jobs.【F:sql/migrations/20251022_create_cron_job_config.sql†L1-L34】

dirRequest cron registration happens immediately at boot (subject to `ENABLE_DIRREQUEST_GROUP`). Every dirRequest job key is single-flight: if a previous run is still in-flight, the next scheduled run logs a skip message and exits early to prevent overlap.【F:src/cron/dirRequest/index.js†L1-L108】


### Cron affinity map (direktorat vs operator polres)


### WA client routing standard

- Routing WA untuk cron dipusatkan di `src/cron/waClientRouting.js`.
- Job dirRequest terjadwal menggunakan route **direktorat-first** (`WA -> WA-GATEWAY`).
- Job cron non-dirRequest menggunakan route **operator-first** (`WA-GATEWAY -> WA`).
- Tujuannya agar konfigurasi pengiriman/fallback konsisten lintas module dan memudahkan maintenance saat ada perubahan session WhatsApp.


Manifest cron menggunakan properti `affinity` untuk menandai afiliasi setiap job:

- `affinity: direktorat` → dijalankan ketika session WA direktorat siap.
- `affinity: operatorPolres` → dijalankan ketika session WA operator polres siap.
- `affinity: platform` → tidak bergantung pada salah satu afiliasi (bucket `always`).

Bucket runtime yang aktif sekarang:

- `always`
- `direktorat`
- `operatorPolres`


### Observability update: cronOprRequestAmplifyRoutineUpdate

- Sebelum query `findAllActiveOrgAmplifyClients()`, cron menulis log fase: `Mulai ambil daftar client amplifikasi aktif`.
- Setelah query sukses, cron menulis log fase: `Selesai ambil daftar client, total X` (nilai `X` adalah jumlah data client yang didapat).
- Query daftar client dibungkus `Promise.race` dengan timeout 45 detik. Jika timeout, cron mengirim `sendDebug` bertag cron dengan pesan: `[TIMEOUT] Tahap query daftar client amplifikasi aktif macet/melewati batas waktu (45 detik).`.
- Error timeout akan masuk jalur `catch` global, namun alur tetap menuju `finally` untuk melepas distributed lock dan mencatat log `Lock released`.

## Cron Jobs

Use the helper script below to regenerate the manifest-driven table so that schedules stay aligned with the manifest and source files:

```bash
node docs/scripts/renderCronSchedule.js > /tmp/cron-jobs.md
```

Then paste the output into this section. The table is sourced from `src/cron/cronManifest.js` and each module's `scheduleCronJob` call.

### Core cron jobs (manifest-driven, split by affinity)

| File | Schedule (Asia/Jakarta) | Description |
|------|-------------------------|-------------|
| `cronRekapLink.js` | `5 15,18,21 * * *` | Distribute amplification link recaps to all active amplification clients. |
| `cronAmplifyLinkMonthly.js` | `0 23 28-31 * *` | Generate and deliver monthly amplification spreadsheets on the last day of the month. |
| `cronDirRequestRekapUpdate.js` | `0 8-18/4 * * *` | Send Ditbinmas executive summaries and rekap updates to admins and broadcast groups. |
| `cronOprRequestAbsensiUpdateDataUsername.js` | `45 6 * * *` | Send oprrequest absensi update data username recaps to active org clients with Instagram + TikTok enabled, delivered to each WhatsApp group. |
| `cronOprRequestAbsensiEngagement.js` | `20 15,18,20 * * *` | Send oprrequest engagement absensi Instagram (likes) and TikTok (comments) recaps with the "all" mode to each org WhatsApp group plus operator and super admin recipients. |
| `cronOprRequestAmplifyRoutineUpdate.js` | `55,25 8-21 * * *` | Refresh oprrequest tugas rutin amplification content for active org clients with amplification enabled and `client_insta_status=true`; execution now uses distributed lock key `cron:oprrequest:amplify-routine-update` so overlapping instances skip when lock is held. Tahap query daftar client menulis log fase `Mulai ambil daftar client amplifikasi aktif` dan `Selesai ambil daftar client, total X`, serta memakai timeout 45 detik agar hang terdeteksi eksplisit dengan log `[TIMEOUT] Tahap query daftar client amplifikasi aktif macet/melewati batas waktu (45 detik).`. |
| `cronDashboardSubscriptionExpiry.js` | `*/48 * * * *` | Mark overdue dashboard subscriptions as expired and send WhatsApp reminders when a destination number is available. |
| `cronPremiumExpiry.js` | `0 0 * * *` | Expire mobile premium users when `premium_end_date` is in the past. |

### Ditbinmas dirRequest group (registered via `registerDirRequestCrons`)

The schedules below are bundled inside `src/cron/dirRequest/index.js` and register immediately during boot. Set `ENABLE_DIRREQUEST_GROUP=false` in the environment to pause all of them together without editing each job record. The table order mirrors the serialized registration chain, and the cron expressions are staggered to avoid overlapping WhatsApp sends in the Asia/Jakarta timezone.【F:src/cron/dirRequest/index.js†L1-L108】

| File | Schedule (Asia/Jakarta) | Description |
|------|-------------------------|-------------|
| `cronWaNotificationReminder.js` | `5 17 * * *<br>35 17 * * *` | Send WhatsApp task reminders to Ditbinmas and BIDHUMAS users who opted in, spacing each WhatsApp delivery by 3 seconds and persisting each recipient's last stage/completion in `wa_notification_reminder_state` so completed users are skipped on reruns while pending users continue their follow-up stage. |
| `cronDirRequestDitbinmasGroupRecap.js` | `52 15 * * *<br>19 18 * * *` | Send Ditbinmas group-only recap by running dirRequest menus 21 and 22 with explicit context period "hari ini" and normalized role routing for stable execution. |
| `cronDirRequestDitbinmasSuperAdminDaily.js` | `16 18 * * *` | Send Ditbinmas super admin-only recaps by running dirRequest menus 6, 9, 34, and 35 with the "hari ini" engagement period. |
| `cronDirRequestDitbinmasOperatorDaily.js` | `17 18 * * *` | Send Ditbinmas operator-only reports by running dirRequest menu 30 with the "hari ini" period. |
| `cronDirRequestDitintelkamMorning.js` | `10 7 * * *` | Send DITINTELKAM morning rekap by running dirRequest menus 1 and 3 to the directorate WhatsApp group only. |
| `cronDirRequestDitintelkamRoutine.js` | `9 10,12,14,16,18,20,22 * * *` | Send DITINTELKAM routine rekap by running dirRequest menus 6 and 9 to group, operator, and super admin recipients from the client contact fields. |
| `cronDirRequestBidhumasEvening.js` | `45 15 * * *<br>15 20 * * *<br>15 22 * * *` | Send dirRequest menus 6, 9, 28, and 29 exclusively to the BIDHUMAS group and its super admin recipients at exactly 22:00 WIB (no fetch post/engagement step), with explicit period context for menus 28/29 to stabilize per-content recap delivery. |

#### Ditbinmas WA reminder persistence

- `cronWaNotificationReminder` writes the per-date, per-`chat_id` + `client_id` reminder state into the `wa_notification_reminder_state` table (primary key: `date_key`, `chat_id`, `client_id`) only after a successful WhatsApp delivery, so the worker can recover after restarts without re-sending completed users while failed deliveries are retried on the next run. Columns include `last_stage` (`initial`, `followup1`, `followup2`, `completed`) and `is_complete` to gate follow-up sends per recipient.
- On each run the job reads the stored state to pick the correct stage, skips rows where `is_complete=true`, and only advances the stage for recipients whose previously stored stage is behind the current run. This keeps once-per-day delivery guarantees for completions while still pushing pending recipients forward to their next follow-up slot.

Each job collects data from the database, interacts with RapidAPI or WhatsApp services, and updates the system accordingly. Refer to [docs/naming_conventions.md](naming_conventions.md) for code style guidelines.
