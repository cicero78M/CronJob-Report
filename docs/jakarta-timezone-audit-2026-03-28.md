# Audit Konsistensi Date Jakarta/WIB (2026-03-28)

## Ringkasan
Audit ini fokus ke penggunaan `Date`/timestamp yang masih berpotensi mengikuti timezone server (UTC/local OS), bukan **Asia/Jakarta (WIB)**.

## Metodologi
Deteksi awal dilakukan dari source code dengan pola berikut:
- `new Date(...)`
- `toISOString()`
- `toLocaleDateString(...)`
- `toLocaleString(...)`
- operasi tanggal lokal (`getDate/getMonth/getFullYear/setDate/setHours`)

Lalu difilter untuk baris yang **tidak eksplisit** menyebut `Asia/Jakarta` atau helper bertema Jakarta.

## Temuan Prioritas Tinggi
Berikut file dengan jumlah temuan paling tinggi (indikasi risiko inkonsistensi):

1. `src/service/engagementRankingExcelService.js` (45)
2. `src/handler/fetchpost/instaFetchPost.js` (20)
3. `src/handler/fetchabsensi/dashboard/absensiLoginWeb.js` (17)
4. `src/handler/fetchpost/tiktokFetchPost.js` (16)
5. `src/service/kasatBinmasLikesRecapService.js` (15)
6. `src/service/weeklyCommentRecapExcelService.js` (14)
7. `src/service/instaRapidService.js` (14)
8. `src/model/instaPostModel.js` (12)
9. `src/utils/utilsHelper.js` (11)
10. `src/service/dashboardPremiumRequestService.js` (11)

> Catatan: angka adalah **indikasi lokasi rawan**, bukan otomatis bug. Tetap perlu validasi per fungsi/bisnis flow.

## Perbaikan yang Sudah Diterapkan
1. Menambahkan util terpusat `src/utils/jakartaTime.js` untuk:
   - format ISO tanggal Jakarta,
   - format ISO timestamp Jakarta (`+07:00`),
   - ekstraksi komponen tanggal/jam Jakarta,
   - formatter locale dengan timezone Jakarta.
2. Menormalkan helper umum di `src/utils/utilsHelper.js` agar default ke Jakarta untuk:
   - `getGreeting`,
   - `formatDdMmYyyy`,
   - `formatIsoDate`,
   - `formatIsoTimestamp`.
3. Memperbaiki penamaan file export yang sebelumnya memakai `toISOString()` (UTC) agar memakai timestamp Jakarta di:
   - `src/service/satkerUpdateMatrixService.js`,
   - `src/service/kasatBinmasLikesRecapExcelService.js`,
   - `src/service/kasatBinmasTiktokCommentRecapExcelService.js`,
   - `src/service/engagementRankingExcelService.js`.

## Langkah Perbaikan Lanjutan (Agar 100% Konsisten)

### Fase 1 (Wajib, cepat)
- Ganti seluruh `toISOString().slice(0, 10)` untuk kebutuhan **tanggal bisnis** menjadi helper Jakarta.
- Pastikan semua `toLocaleDateString`/`toLocaleString` menyertakan `timeZone: 'Asia/Jakarta'` atau pakai util terpusat.
- Untuk query SQL berbasis hari ini/kemarin/mingguan/bulanan, standarkan ke `(column AT TIME ZONE 'Asia/Jakarta')`.

### Fase 2 (Stabilisasi)
- Refactor semua boundary date range (`start/end`) ke helper Jakarta (start of day / end of day WIB) agar tidak drift ketika server timezone berubah.
- Tambahkan unit test lintas batas hari (contoh: `23:30 UTC` = `06:30 WIB`) untuk flow:
  - report harian,
  - cron harian,
  - filename export bertanggal.

### Fase 3 (Hardening)
- Tambahkan guard lint custom (atau script CI) yang menolak:
  - `toISOString().slice(0,10)` tanpa helper Jakarta,
  - `toLocaleDateString()` tanpa timezone,
  - query SQL `::date = NOW()::date` tanpa `AT TIME ZONE 'Asia/Jakarta'`.
- Jalankan audit berkala dan simpan output ke docs.

## Definisi Konsistensi yang Disarankan
- **Display date/time ke user:** selalu WIB (Asia/Jakarta).
- **Label tanggal bisnis (harian/report):** berbasis WIB.
- **Timestamp penyimpanan:** boleh UTC atau timestamptz, tapi konversi query/report ke WIB wajib eksplisit.
- **Cron schedule:** timezone scheduler wajib `Asia/Jakarta`.
