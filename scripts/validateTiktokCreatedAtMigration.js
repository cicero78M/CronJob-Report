#!/usr/bin/env node
import { query, close } from '../src/db/index.js';
import { fetchTiktokPostDetail } from '../src/service/tiktokApi.js';

function parseArgs(argv) {
  const args = { sample: 10, days: 14, videoIds: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--sample' && argv[i + 1]) {
      args.sample = Number(argv[++i]) || args.sample;
    } else if (token === '--days' && argv[i + 1]) {
      args.days = Number(argv[++i]) || args.days;
    } else if (token === '--video-id' && argv[i + 1]) {
      args.videoIds.push(argv[++i]);
    }
  }
  return args;
}

async function hasColumn(columnName) {
  const res = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tiktok_post'
       AND column_name = $1
     LIMIT 1`,
    [columnName]
  );
  return res.rowCount > 0;
}

async function auditHourDistribution(days) {
  const res = await query(
    `SELECT
       DATE(created_at AT TIME ZONE 'Asia/Jakarta') AS jakarta_date,
       EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Jakarta'))::INT AS jakarta_hour,
       COUNT(*)::INT AS total
     FROM tiktok_post
     WHERE created_at >= NOW() - ($1::INT || ' days')::INTERVAL
     GROUP BY 1, 2
     ORDER BY 1 DESC, 2 ASC`,
    [days]
  );

  const peakWindow = res.rows.filter((row) => row.jakarta_hour >= 17 && row.jakarta_hour <= 23);

  console.log('\n=== DISTRIBUSI JAM (Asia/Jakarta) ===');
  console.table(res.rows.slice(0, 200));
  console.log('\n=== FOKUS JAM 17:00-23:59 WIB ===');
  console.table(peakWindow.slice(0, 200));
}

async function auditShiftWindow(days) {
  const backupExists = await hasColumn('created_at_utc_naive_backup');
  if (!backupExists) {
    console.log('\n[INFO] Kolom created_at_utc_naive_backup tidak ditemukan, skip audit shift parity.');
    return [];
  }

  const res = await query(
    `SELECT
       video_id,
       client_id,
       created_at,
       created_at_utc_naive_backup,
       created_at AT TIME ZONE 'Asia/Jakarta' AS created_at_wib,
       (created_at_utc_naive_backup AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta' AS backup_wib,
       EXTRACT(EPOCH FROM (created_at - (created_at_utc_naive_backup AT TIME ZONE 'UTC')))::BIGINT AS shift_seconds
     FROM tiktok_post
     WHERE created_at >= NOW() - ($1::INT || ' days')::INTERVAL
       AND EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Jakarta')) BETWEEN 17 AND 23
     ORDER BY created_at DESC
     LIMIT 200`,
    [days]
  );

  const anomalies = res.rows.filter((row) => Number(row.shift_seconds) !== 0);
  console.log('\n=== SAMPLE BARIS JAM 17:00-23:59 WIB ===');
  console.table(res.rows);
  console.log(`\n[INFO] Potensi anomali shift (shift_seconds != 0): ${anomalies.length}`);
  return anomalies;
}

async function compareWithApi(videoIds, sample) {
  let ids = [...new Set(videoIds.filter(Boolean))];

  if (ids.length === 0) {
    const sampleRes = await query(
      `SELECT video_id
       FROM tiktok_post
       WHERE EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Jakarta')) BETWEEN 17 AND 23
       ORDER BY created_at DESC
       LIMIT $1`,
      [sample]
    );
    ids = sampleRes.rows.map((row) => row.video_id);
  }

  if (ids.length === 0) {
    console.log('\n[INFO] Tidak ada video_id sample untuk compare API.');
    return;
  }

  const dbRows = await query(
    `SELECT video_id, client_id, created_at FROM tiktok_post WHERE video_id = ANY($1)`,
    [ids]
  );
  const dbMap = new Map(dbRows.rows.map((row) => [row.video_id, row]));

  const output = [];
  for (const videoId of ids) {
    try {
      const detail = await fetchTiktokPostDetail(videoId);
      const apiUnix = detail?.createTime ?? detail?.create_time ?? detail?.timestamp ?? null;
      const apiDate = apiUnix ? new Date(Number(apiUnix) * 1000) : null;
      const dbDate = dbMap.get(videoId)?.created_at ? new Date(dbMap.get(videoId).created_at) : null;

      output.push({
        video_id: videoId,
        client_id: dbMap.get(videoId)?.client_id || null,
        db_created_at_utc: dbDate ? dbDate.toISOString() : null,
        api_create_time_unix: apiUnix,
        api_created_at_utc: apiDate && !Number.isNaN(apiDate.getTime()) ? apiDate.toISOString() : null,
        delta_seconds:
          dbDate && apiDate && !Number.isNaN(apiDate.getTime())
            ? Math.round((dbDate.getTime() - apiDate.getTime()) / 1000)
            : null,
      });
    } catch (err) {
      output.push({ video_id: videoId, error: err.message || String(err) });
    }
  }

  console.log('\n=== VALIDASI SAMPLE API createTime vs DB created_at ===');
  console.table(output);
}

async function main() {
  const { sample, days, videoIds } = parseArgs(process.argv);
  await auditHourDistribution(days);
  await auditShiftWindow(days);
  await compareWithApi(videoIds, sample);
}

main()
  .catch((err) => {
    console.error('[ERROR] validateTiktokCreatedAtMigration', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close?.();
  });
