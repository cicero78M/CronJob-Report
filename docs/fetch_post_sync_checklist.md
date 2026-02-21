# Fetch Post Sync Checklist
*Last updated: 2026-02-21*

Dokumen ini dipakai saat melakukan perubahan pada alur sinkronisasi fetch post Instagram agar logika utama tetap konsisten antara handler, cron, dan model.

## 1) File yang wajib dibandingkan

Minimal cek perubahan di file berikut:

- Handler fetch utama:
  - `src/handler/fetchpost/instaFetchPost.js`
- Cron yang memanggil fetch post:
  - `src/cron/cronOprRequestAmplifyRoutineUpdate.js`
- Model/akses data terkait upsert post:
  - `src/model/instaPostModel.js`
  - `src/model/instaPostExtendedModel.js`
- Model eligibility client yang dipakai cron:
  - `src/model/clientModel.js`

Jika ada perubahan perilaku query, tambahkan juga file query/helper terkait ke checklist PR.

## 2) Checklist perilaku yang wajib lolos review

### A. Filter hari WIB (Asia/Jakarta)

- [ ] Handler masih memfilter konten hari ini berbasis WIB (`isTodayJakarta` atau padanan setara).
- [ ] Query ringkasan harian tetap membatasi `DATE(created_at)` atau padanan timezone-aware yang setara.
- [ ] Tidak ada pergeseran timezone implisit yang mengubah hasil (mis. UTC-only tanpa konversi).

### B. Eligibility client

- [ ] Hanya client aktif yang diproses (`client_status=true`).
- [ ] Validasi status Instagram/amplify tetap diterapkan (`client_insta_status` / `client_amplify_status`).
- [ ] Client tanpa username Instagram valid tetap dilewati dengan logging yang jelas.

### C. Upsert/delete strategy

- [ ] Upsert post utama tetap memakai konflik `shortcode` (`ON CONFLICT (shortcode)`).
- [ ] Delete sinkronisasi hanya dijalankan ketika fetch sukses (hindari wipe saat API gagal).
- [ ] Delete terkait tabel turunan (likes/audit/comment) tetap aman dan tidak merusak data lintas hari.

### D. Error handling

- [ ] Error per-client tidak menghentikan proses client lain (continue / isolated try-catch per client).
- [ ] Error global cron tetap tercatat (`sendDebug`/logger) dan lock selalu dilepas di `finally`.
- [ ] Pesan error cukup informatif untuk investigasi (tag + konteks client).

## 3) Script validasi cepat CI

Gunakan script:

```bash
bash scripts/check-fetch-sync.sh
```

Script ini memvalidasi hal kritis via `rg`:

- signature fungsi `fetchAndStoreInstaContent`,
- konstanta cron expression + timezone,
- filter query kritis (`DATE(created_at)` dan guard delete saat fetch sukses).

## 4) Prosedur manual jika URL referensi berubah

Contoh kasus: URL Instagram berubah format, endpoint API berubah host/path, atau shortcode extraction berubah.

1. Identifikasi semua referensi URL terkait:
   ```bash
   rg -n "instagram\.com|fetchInstagramPosts|extractInstagramShortcode|shortcode" src/handler src/service src/model
   ```
2. Bandingkan perubahan perilaku sebelum/sesudah:
   ```bash
   git diff -- src/handler/fetchpost/instaFetchPost.js src/service/instagramApi.js src/utils/utilsHelper.js
   ```
3. Jalankan validasi cepat sinkronisasi:
   ```bash
   bash scripts/check-fetch-sync.sh
   ```
4. Tempelkan ringkasan diff di PR body dengan format berikut:

   ```md
   ## Fetch Post Sync Diff Summary
   - Scope: `src/handler/fetchpost/instaFetchPost.js`, `src/cron/cronOprRequestAmplifyRoutineUpdate.js`, `src/model/instaPostModel.js`
   - URL/reference changes:
     - [old] `https://www.instagram.com/p/<shortcode>`
     - [new] `<isi perubahan>`
   - Behavior checks:
     - WIB filter: pass/fail (+ catatan)
     - Eligibility client: pass/fail (+ catatan)
     - Upsert/delete strategy: pass/fail (+ catatan)
     - Error handling: pass/fail (+ catatan)
   - Validation command output:
     - `bash scripts/check-fetch-sync.sh` => pass/fail
   ```

## 5) Rekomendasi review PR

- Wajib cantumkan hasil `npm run lint` dan `npm test`.
- Jika ada limitasi environment, tulis alasannya pada bagian **Testing** di PR.
- Pastikan working tree bersih sebelum merge.
