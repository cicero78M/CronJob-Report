# Menu DirRequest untuk Operator WA
*Last updated: 2026-01-22*

Menu **dirrequest** digunakan tim Ditbinmas untuk memicu pengambilan data,
rekap, dan laporan langsung dari WhatsApp. Menu utama menampilkan beberapa
grup seperti Rekap Data, Absensi, Pengambilan Data, hingga Monitoring
Kasatker. Setiap opsi dipilih dengan membalas angka menu sesuai label yang
ditampilkan bot.


## Routing WA untuk Cron (update 2026-02-11)

Standar routing terbaru agar konsisten dan mudah di-maintain:

- Cron **dirRequest terjadwal** menggunakan rute **WA Direktorat** sebagai primary (`waClient`) dengan fallback ke **WA Operator**.
  - `cronWaNotificationReminder`
  - `cronDirRequestBidhumasEvening`
  - `cronDirRequestDitbinmasGroupRecap`
  - `cronDirRequestDitbinmasSuperAdminDaily` (via `cronDirRequestCustomSequence`)
  - `cronDirRequestDitbinmasOperatorDaily` (via `cronDirRequestCustomSequence`)
  - `cronDirRequestDitbinmasAbsensiToday`
- Cron lain di `src/cron` menggunakan rute **WA Operator** sebagai primary (`waGatewayClient`) dengan fallback ke **WA Direktorat** bila diperlukan.
- Pemilihan rute WA dipusatkan di `src/cron/waClientRouting.js` agar konfigurasi client/fallback tidak duplikatif di setiap module cron.

Output menu dari `performAction` kini memakai jalur pengiriman aman khusus chat
grup (`@g.us`) agar bot melewati chat grup yang belum ter-hydrate tanpa
mengubah perilaku pengiriman ke user personal. Pengiriman di grup menggunakan
`safeSendMessage` untuk memastikan chat siap sebelum balasan dikirim.

Untuk eksekusi menu dirrequest via cron, pemilihan client WA kini dilakukan
secara berurutan: **WA-GATEWAY** → **WA** → **WA-USER**. Cron akan memanggil
`waitForWaReady()` pada tiap client dan otomatis fallback jika gateway gagal
siap. Setiap fallback mencatat label client, alasan kegagalan, serta action
menu ke log cron agar mudah ditelusuri. Pengiriman menu memakai
`sendWithClientFallback`, sehingga bila pengiriman gagal pada client utama,
bot akan mencoba client berikutnya dan tetap mencatat konteks action yang
sama di log.

Mulai 18:27 WIB setiap hari, cron khusus Ditbinmas mengeksekusi menu **5**
(absensi likes) dan **10** (absensi komentar) dengan periode **hari ini**
dan hanya mengirim ke penerima khusus `081331780006` (format WA dinormalisasi
ke `@c.us`). Jadwal ini berada di grup cron `dirrequest` sehingga mengikuti
flag `ENABLE_DIRREQUEST_GROUP`.

Blok menu utama kini mencantumkan grup baru **Rekap All Data** dengan opsi:

```
📦 *Rekap All Data*
4️⃣2️⃣ Instagram all data
4️⃣3️⃣ TikTok all data
```

Opsi **4️⃣2️⃣** menjalankan generator Excel rekap likes Instagram lintas polres
(per client Direktorat yang aktif) dan mengirimkan berkasnya via WhatsApp.
Urutan polres pada rekap otomatis disusun dari total akumulasi likes tertinggi
ke terendah agar polres paling aktif muncul di bagian atas. File sementara
disimpan di `export_data/dirrequest` dengan nama berisi client, tanggal, serta
jam eksekusi sebelum dihapus setelah dikirim.

Opsi **4️⃣3️⃣** menyiapkan rekap komentar TikTok lintas polres dengan pola bulan
yang sama (September–bulan berjalan) dan mengirimkan Excel ke WA. Struktur
kolomnya mengikuti rekap Instagram: deretan bulan per kolom, total per polres,
dan baris grand total di bagian bawah.

Input **4️⃣3️⃣** kini dikenali langsung oleh bot tanpa balasan *"Pilihan tidak
valid"*, sehingga operator dapat memicu rekap TikTok all data dari menu utama
dirrequest tanpa langkah tambahan.

## WA delivery failure matrix (incident response)

Rujukan cron terkait: `src/cron/cronDirRequestDitbinmasGroupRecap.js`.

| Kondisi | Indikasi di log | Verifikasi utama | Tindakan cepat |
| --- | --- | --- | --- |
| Timeout primary (`wa-direktorat`) | Pengiriman pertama timeout/gagal pada client primary, lalu muncul fallback ke client lain. | Cek status session/auth client `wa-direktorat` dan konektivitas ke WA Web. | Re-auth `wa-direktorat`, restart worker bila perlu, lalu kirim ulang ke grup target. |
| 403 group permission (`wa-operator`) | Error `403` saat kirim ke grup pada jalur fallback `wa-operator`. | Verifikasi bot `wa-operator` masih menjadi anggota grup dan masih punya izin kirim pesan. | Re-join bot `wa-operator` ke grup, pastikan permission kirim aktif, lalu ulangi eksekusi. |

### Verifikasi cepat saat incident

1. Validasi ID grup menggunakan format `@g.us` (contoh: `1203xxxxxxxxxx@g.us`).
2. Cek membership kedua bot (`wa-direktorat`, `wa-operator`) pada grup target.
3. Jalankan prosedur re-join/re-auth:
   - Re-join bot ke grup jika keluar/terkick.
   - Re-auth session bot yang bermasalah (scan ulang bila session invalid).
   - Uji kirim pesan manual singkat sebelum rerun cron.

### Contoh log signature untuk pencarian incident

Gunakan potongan signature berikut sebagai kata kunci pencarian log (sesuaikan timestamp):

```text
[cronDirRequestDitbinmasGroupRecap] primary send failed via wa-direktorat: timeout after 15000ms
[cronDirRequestDitbinmasGroupRecap] fallback send failed via wa-operator: 403 Forbidden (group permission)
[cronDirRequestDitbinmasGroupRecap] target=1203xxxxxxxxxx@g.us action=group-recap
```


## Sinkronisasi menu dirrequest untuk eksekusi cron
- Eksekusi `runDirRequestAction` kini mengenali menu **2️⃣1️⃣**, **2️⃣2️⃣**, **2️⃣8️⃣**, **2️⃣9️⃣**, **3️⃣0️⃣**, **3️⃣4️⃣**, dan **3️⃣5️⃣** agar selaras dengan jadwal cron Ditbinmas/Bidhumas.
- Mapping menu cron yang dipakai service:
  - **2️⃣1️⃣**: ringkasan laporan harian gabungan Instagram + TikTok (`lapharDitbinmas` dan `lapharTiktokDitbinmas`).
  - **2️⃣2️⃣**: kirim file Excel ranking engagement (`saveEngagementRankingExcel`) dengan konteks periode dari cron.
  - **2️⃣8️⃣**: kirim file Excel rekap likes Instagram per konten (`saveLikesRecapPerContentExcel`).
  - **2️⃣9️⃣**: kirim file Excel rekap komentar TikTok per konten (`saveCommentRecapPerContentExcel`).
  - **3️⃣0️⃣**: kirim ringkasan absensi Kasatker (`generateKasatkerAttendanceSummary`).
  - **3️⃣4️⃣**: kirim narasi absensi likes Kasat Binmas (`generateKasatBinmasLikesRecap`) dengan dukungan `context.period` dari cron (`today` dinormalisasi menjadi `daily`).
  - **3️⃣5️⃣**: kirim narasi absensi komentar TikTok Kasat Binmas (`generateKasatBinmasTiktokCommentRecap`) dengan dukungan `context.period` dari cron (`today` dinormalisasi menjadi `daily`).
- Dengan sinkronisasi ini, pesan fallback **"Menu tidak dikenal."** untuk menu cron di atas tidak lagi muncul.

## Rekaman Snapshot Engagement per 30 Menit
- Setiap pengambilan likes Instagram dan komentar TikTok yang berjalan lewat
  jadwal 30 menit kini juga menyimpan salinan ke tabel arsip
  `insta_like_audit` dan `tiktok_comment_audit`. Kolom yang dicatat mencakup
  `shortcode`/`video_id`, `usernames` (JSONB), `snapshot_window_start`,
  `snapshot_window_end`, dan `captured_at` (default `NOW()`).
- Generator pesan tugas sosmed dapat menerima rentang waktu (mis. 30 menit
  terakhir). Jika rentang diberikan, generator lebih dulu membaca snapshot
  terbaru dari tabel audit dan menampilkan label **"Data rentang HH–HH WIB"**.
  Jika arsip untuk rentang tersebut kosong, perhitungan otomatis jatuh ke
  tabel utama seperti sebelumnya sehingga pesan tetap terisi.
- Operator dapat menggunakan rentang ini ketika meninjau hasil fetch per shift
  atau ketika menyusun laporan khusus yang membutuhkan sumber data dengan
  timestamp eksekusi fetch yang eksplisit.
- Setelah pukul **17.00 WIB**, cron fetch sosmed hanya menjalankan refresh
  likes Instagram dan komentar TikTok tanpa menarik postingan baru. Slot
  malam (mis. 18.00, 19.00, 20.00, 21.00, dan 20:30 gabungan) tetap aktif
  untuk menjaga pembaruan engagement, tetapi pengambilan konten baru
  dilewati kecuali dipaksa manual sebelum 17.00 WIB.

## Absensi Likes Instagram (Format Dirrequest)
- Rekap absensi likes Instagram (menu dirrequest untuk Direktorat) kini
  menampilkan setiap divisi sebagai header tebal, dipisahkan satu baris kosong
  agar mudah dibaca pada WhatsApp.
- Urutan divisi utama disusun berdasarkan **Akumulasi Pelaksanaan** tertinggi
  (total likes dari seluruh personel pada divisi), lalu fallback ke persentase
  ketercapaian/ukuran divisi bila nilainya sama.
- Header divisi memuat ringkasan:
  - `*NAMA DIVISI*`
  - `Akumulasi Pelaksanaan: <total> (dari <jumlah konten>)`
  - `Jumlah Personil: <angka>`
- Setiap personel ditampilkan dengan label pelaksanaan yang jelas, misalnya
  `- Nama, Pelaksanaan: 3/5`, sehingga operator dapat melihat jumlah konten
  yang sudah dilike oleh masing-masing personel secara cepat.

## Absensi Komentar TikTok Kasat Binmas
- Submenu Absensi Komentar TikTok mengikuti tanggal **Asia/Jakarta (WIB)**.
  Periode harian yang dipilih dari WhatsApp otomatis menormalkan tanggal ke
  WIB sebelum dikirim ke query database sehingga konten di luar hari berjalan
  tidak ikut dihitung.
- Perhitungan harian/mingguan/bulanan kini memaksa konversi zona waktu ke
  **Asia/Jakarta** secara eksplisit (menggunakan `Intl.DateTimeFormat`)
  sehingga tanggal tidak akan melenceng meski server menjalankan bot dengan
  zona waktu default yang berbeda.
- Filter database harian untuk konten TikTok sudah menggunakan `(created_at AT
  TIME ZONE 'Asia/Jakarta')::date` dengan parameter *reference date* opsional
  (default ke *Jakarta now*) sehingga label periode dan filter query selalu
  selaras, termasuk ketika server berjalan di luar WIB.
- Alur menu dapat memasok `referenceDate` (mis. menyimpan `session.referenceDate`
  atau `session.dirRequestReferenceDate`) untuk memaksa label periode, rentang
  minggu, serta parameter query memakai tanggal eksekusi yang diinginkan.
  Nilai yang berada di masa depan otomatis diabaikan agar rekap tidak memakai
  tanggal yang belum terjadi; fallbacknya memakai tanggal **Asia/Jakarta**
  saat ini sehingga selaras dengan menu 3️⃣4️⃣ *Absensi Likes Instagram Kasat Binmas*.
- Nilai `referenceDate` yang dikirim lewat menu 3️⃣5️⃣ kini dinormalisasi lebih
  dulu menggunakan helper `resolveBaseDate` agar tanggal tidak valid atau
  tanggal di masa depan langsung digeser ke hari ini (WIB). Override tanggal
  di sesi `dirrequest` juga otomatis dibersihkan setelah digunakan sehingga
  pemanggilan manual berikutnya kembali memakai hari berjalan, kecuali operator
  secara eksplisit mengirim tanggal lampau yang valid.
- Perhitungan harian membaca tanggal Asia/Jakarta tanpa konversi ganda sehingga
  label periode tidak lagi lompat ke hari berikutnya (contoh: Senin dini hari
  tetap menggunakan Minggu jika rekap dijalankan sebelum pukul 24.00 WIB).
- Pengambilan data langsung (live fallback) kini khusus untuk periode harian.
  Rekap mingguan/bulanan akan menampilkan peringatan jika database belum
  memiliki data pada rentang tersebut, sehingga label periode dan sumber data
  tetap konsisten dengan format laporan di menu 3️⃣4️⃣.
- Format laporan absensi komentar TikTok dirrequest kini menampilkan ringkasan
  per divisi dengan aturan berikut:
  - Header divisi dicetak **tebal** dan dipisahkan dengan satu baris kosong
    agar mudah dibaca di WhatsApp.
  - Urutan divisi disusun dari **Akumulasi Pelaksanaan** tertinggi (total
    komentar dari seluruh personel divisi) ke terendah.
  - Header memuat `Jumlah Personil` dan `Akumulasi Pelaksanaan` (total komentar
    dibanding total target divisi).
  - Setiap personel memakai format
    `- Nama, Pelaksanaan: <commentCount>/<totalKonten>` untuk menampilkan
    jumlah konten yang dikomentari secara jelas.

## Rekap Kelengkapan data Personil Satker (Menu 1)
- Label menu utama diperbarui menjadi **1️⃣ Rekap Kelengkapan data Personil Satker.**
  Contoh cuplikan bagian *Rekap Data* pada menu utama:

  ```
  📊 *Rekap Data*
  1️⃣ Rekap Kelengkapan data Personil Satker.
  2️⃣ Ringkasan pengisian data personel
  3️⃣ Rekap data belum lengkap
  4️⃣ Rekap Matriks Update Satker
  ```
- Fungsionalitas tetap sama: bot mengirim rekap personel yang belum melengkapi
  data dan mengelompokkannya per satker sesuai *Client ID* Direktorat yang aktif.
  Urutan daftar pada rekap kini menempatkan **hanya** client Direktorat
  peminta yang memiliki role sama dengan permintaan di posisi pertama, lalu
  diikuti client bertipe **ORG** yang memiliki role sama dengan *Client ID*
  peminta (client Direktorat lain otomatis diabaikan).
- Filter role menyesuaikan tipe client: permintaan dari client bertipe
  **Direktorat** otomatis memakai role default setara *Client ID* ketika
  operator tidak mengirim *roleFlag*, sedangkan client **ORG** tetap menghargai
  *roleFlag* Direktorat yang valid sehingga rekap hanya menghitung personel
  dengan role tersebut.
  Perhitungan rekap **hanya** memasukkan personel yang memiliki role sesuai
  Direktorat peminta atau role yang sedang difilter, termasuk ketika
  Direktorat merekap client ORG.
- Contoh perilaku filter:
  - Direktorat `DITBINMAS` tanpa `roleFlag` → rekap menghitung personel dengan
    role `DITBINMAS` saja, baik saat membaca client Direktorat sendiri maupun
    client ORG.
  - Direktorat `DITLANTAS` dengan `roleFlag=DITHUMAS` → rekap menyingkirkan
    seluruh personel tanpa role `DITHUMAS`, sehingga hasil bisa terlihat kosong
    jika client tidak memiliki role tersebut.
  - Jika operator memilih Client ID Direktorat yang tidak sama dengan
    `roleFlag`, prioritas filter tetap mengikuti Client ID tersebut, sehingga
    personel dari client bertipe ORG hanya dihitung bila memiliki role yang sama
    dengan Direktorat pilihan.

## Pemilihan Client Direktorat
- Saat mengetik `dirrequest`, bot terlebih dahulu menampilkan daftar
  *Client ID* bertipe **Direktorat** yang berstatus aktif.
- Balas dengan angka pada daftar atau langsung mengetik *Client ID* untuk
  memilih target. Balasan `batal` menutup menu.
- Semua submenu dirrequest (rekap, absensi, monitoring Satbinmas Official,
  dan lainnya) dijalankan berdasarkan *Client ID* yang dipilih sehingga tidak
  selalu bergantung pada default `DITBINMAS`.
- Instruksi di setiap submenu kini menambahkan opsi `back` untuk kembali ke
  menu sebelumnya, sehingga navigasi submenu menjadi seragam.
- Seluruh menu pada kelompok **Absensi** (opsi 5–11) menggunakan *Client ID*
  pilihan operator untuk rekap dan narasi, termasuk nama direktorat/klien yang
  ditampilkan pada pesan hasil.
- Submenu **Pengambilan Data** untuk likes/konten (opsi 12–15) kini sepenuhnya
  mengikuti direktorat yang dipilih pada awal alur `dirrequest`. RapidAPI dan
  pipeline penyimpanan akan menerima *Client ID* yang dipilih, sehingga fetch
  konten/engagement Instagram maupun TikTok dapat dijalankan untuk direktorat
  lain tanpa harus mengganti konfigurasi default. Pesan sukses/gagal yang
  dikirim bot juga menyertakan nama/ID direktorat target agar operator tahu
  dengan jelas sasaran eksekusi.

## Rekap data belum lengkap (Menu 3)
- Label submenu diperbarui menjadi **Rekap data belum lengkap** tanpa
  menyebutkan Ditbinmas.
- Menu ini mengeksekusi rekap berdasarkan *Client ID* bertipe **Direktorat**
  yang sedang aktif. Data yang diringkas mengikuti role direktorat tersebut
  (misalnya `DITBINMAS`, `DITLANTAS`, atau `BIDHUMAS`) tanpa mengunci hanya ke
  Ditbinmas. Ketika menggunakan role tambahan (*roleFlag*), rekap hanya
  menghitung personel yang memiliki role tersebut dan/atau terikat ke
  *Client ID* peminta.
- Output tetap memuat daftar personel yang belum mengisi Instagram/TikTok per
  divisi beserta salam dan stempel waktu eksekusi.
- Format daftar personel pada setiap divisi kini menggunakan nomor urut dan
  detail kekosongan pada baris terpisah (`- Instagram kosong`/`- TikTok
  kosong`) agar konsisten dengan pola laporan operasional Ditintelkam menu
  **3️⃣**.
- Jika seluruh personel sudah melengkapi Instagram/TikTok, helper rekap
  mengembalikan nilai kosong sehingga bot melewati pengiriman balasan dan
  kembali ke menu tanpa menampilkan pesan kosong.

## Rekap Likes Instagram (Excel) (Menu 1️⃣9️⃣)
- Menu **1️⃣9️⃣** menyiapkan rekap likes Instagram dalam format Excel berdasarkan
  `collectLikesRecap`. Jika helper mengembalikan string (misalnya karena data
  kosong), bot mengirim pesan tersebut dan menghentikan proses.
- Apabila tidak ada `shortcodes`, bot mengirim pesan bahwa tidak ada konten IG
  untuk hari ini.
- Jika `saveLikesRecapExcel` gagal (contohnya workbook kosong atau data tidak
  valid), bot mengirim pesan error spesifik bahwa pembuatan file Excel gagal
  agar operator tahu penyebab kegagalan.
- Kegagalan saat membaca file atau mengirim ke WhatsApp menghasilkan pesan
  error yang jelas bahwa file tidak dapat dikirim.
- File sementara dicek terlebih dahulu, lalu dihapus di blok `finally` agar
  file temp tetap dibersihkan meskipun terjadi error.

## Rekap Komentar TikTok (Excel) (Menu 2️⃣0️⃣)
- Menu **2️⃣0️⃣** menyiapkan rekap komentar TikTok dalam format Excel berdasarkan
  data `collectKomentarRecap` untuk *Client ID* yang aktif.
- Jika pengambilan data komentar gagal/throw, bot mengirim pesan error yang
  menjelaskan bahwa pengambilan data rekap gagal lalu menghentikan eksekusi
  menu tanpa mencoba membuat file.
- Jika pembuatan file Excel, pembacaan berkas, atau pengiriman ke WhatsApp
  gagal, bot mengirim pesan kegagalan yang jelas agar operator tahu file tidak
  berhasil dikirim.
- File sementara yang berhasil dibuat tetap dibersihkan di blok `finally`
  sehingga tidak tertinggal di storage meskipun terjadi error.

## Laporan Harian Ditbinmas (Menu 2️⃣1️⃣)
- Menu **2️⃣1️⃣** mengirim ringkasan gabungan Instagram dan TikTok untuk
  *Client ID* yang dipilih. Narasi utama disusun lewat
  `formatRekapAllSosmed` berdasarkan hasil `lapharDitbinmas` dan
  `lapharTiktokDitbinmas`, termasuk data ranking jika tersedia.
- Jika laporan teks (`.txt`) tersedia, bot menyimpan sementara berkas di
  folder `laphar`, mengirimkannya ke WhatsApp, lalu menghapus file temp
  setelah proses selesai.
- Rekap Excel likes Instagram hanya dibuat ketika `collectLikesRecap`
  mengembalikan data valid berisi `shortcodes`. Jika helper tersebut
  mengembalikan pesan string (misalnya karena data kosong), bot mengirim
  pesan tersebut dan melewati pembuatan file Excel.
- Rekap Excel komentar TikTok dibuat setelah `collectKomentarRecap` sukses
  mengembalikan `videoIds`. Jika terjadi error saat koleksi data, bot
  mengirim pesan kegagalan dan tidak melanjutkan proses file.
- Seluruh file sementara (teks maupun Excel) dibersihkan di blok `finally`
  untuk mencegah file temp tertinggal.

## Monitoring Kasatker – Rekap Likes IG Kasat Binmas (Excel)
- Blok Monitoring Kasatker kini menambahkan entri **4️⃣4️⃣ Rekap likes Instagram
  Kasat Binmas (Excel)**. Opsi ini berjalan berdampingan dengan menu absensi
  naratif (3️⃣4️⃣) dan komentar TikTok (3️⃣5️⃣), namun langsung menyiapkan file
  Excel tanpa menampilkan rangkuman teks.
- Setelah memilih **4️⃣4️⃣**, bot meminta periode rekap: **1. Harian**, **2.
  Mingguan** (Senin–Minggu berjalan), atau **3. Bulanan**. Balas angka 1–3
  atau ketik *batal* untuk kembali ke menu utama Monitoring Kasatker.
- Saat menu **4️⃣4️⃣** dijalankan lewat dirrequest terjadwal (via context
  `referenceDate`), periode harian/mingguan/bulanan dihitung dari tanggal acuan
  tersebut. Sumber tanggal yang dibaca berurutan dari
  `dirRequestReferenceDate`, `executionDate`, lalu `referenceDate` agar hasil
  rekap selaras dengan jadwal eksekusi.
- Semua respons dalam alur **4️⃣4️⃣** (prompt periode, input invalid, batal,
  maupun pesan error) dikirim memakai `safeSendMessage` agar tidak memicu reset
  sesi WhatsApp.
- File Excel yang dikirim berisi kolom **Polres**, **Pangkat dan Nama**, dan
  **Total Likes (akumulatif)**. Baris diurutkan dari total likes tertinggi,
  lalu pangkat (mengikuti urutan PANGKAT_ORDER Kasat Binmas), lalu nama agar
  rekap mudah dipantau oleh pimpinan.
- Generator Excel menu **4️⃣4️⃣** hanya menyusun tiga kolom inti di atas untuk
  menjaga payload tetap ringan, lalu menyimpan berkas via jalur async
  (buffer → `writeFile`) agar tidak memblokir event loop.
- Jika jumlah personel Kasat Binmas melebihi **500 baris**, proses ekspor
  langsung dihentikan dan bot mengirim pesan singkat agar operator mempersempit
  periode/filter sebelum mencoba ulang.
- Label periode pada baris kedua sheet mengikuti format submenu (contoh: harian
  "Rabu, 22 Mei 2024", mingguan "Senin, 20 Mei 2024 s.d. Minggu, 26 Mei 2024",
  bulanan "Bulan Mei 2024").
- Berkas disimpan sementara di `export_data/dirrequest`, dikirim melalui WA
  dengan MIME Excel, lalu dihapus otomatis setelah proses selesai agar direktori
  kerja tetap bersih.
- Jika tidak ada data Kasat Binmas atau konten Instagram pada periode terpilih,
  bot **tidak** mengirim file. Sebagai gantinya, bot hanya mengirim pesan
  informasi (contoh: "Belum ada konten Instagram Kasat Binmas untuk periode
  ...") lalu langsung kembali ke menu utama Monitoring Kasatker tanpa mengulang
  prompt periode.
- Jika pengiriman gagal, bot mencatat log bertanda **submenu 4️⃣4️⃣** dan
  mengirim pesan error lewat helper `safeSendMessage`. Bot **tidak** keluar
  dari submenu 4️⃣4️⃣ dan tetap menampilkan prompt periode agar operator bisa
  mencoba ulang; perilaku terbaru ini memastikan menu 4️⃣4️⃣ tidak lagi
  memicu "restart" sesi saat gagal kirim file.
- Untuk menjaga stabilitas pengiriman file di menu **4️⃣4️⃣**, pastikan
  konfigurasi environment menetapkan `WA_WEB_VERSION_CACHE_URL` atau
  `WA_WEB_VERSION` yang valid. Rekomendasi: gunakan cache URL
  `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json`
  agar WhatsApp Web version cache tetap sinkron. Jika kedua nilai kosong, cache
  akan dimatikan dan WA client lebih rentan re-init saat beban pengiriman file
  meningkat.

## Monitoring Kasatker – Rekap Komentar TikTok Kasat Binmas (Excel)
- Grup Monitoring Kasatker menambahkan menu **4️⃣5️⃣ Rekap komentar TikTok Kasat
  Binmas (Excel)**. Opsi ini menyajikan rekap akumulasi komentar langsung dalam
  format Excel tanpa narasi teks panjang.
- Setelah memilih **4️⃣5️⃣**, bot menampilkan pilihan periode rekap: **1. Harian**,
  **2. Mingguan** (Senin–Minggu), atau **3. Bulanan**. Operator bisa membalas
  angka 1–3 atau ketik *batal* untuk kembali ke menu Monitoring Kasatker.
- File Excel memuat kolom **Polres**, **Pangkat dan Nama**, dan **Total
  Komentar**. Baris diurutkan berdasarkan total komentar terbanyak, lalu pangkat
  (sesuai urutan PANGKAT_ORDER Kasat Binmas), kemudian nama pengguna untuk
  memudahkan pemetaan capaian.
- Label periode pada baris kedua sheet mengikuti pilihan submenu (contoh: harian
  "Rabu, 22 Mei 2024", mingguan "Senin, 20 Mei 2024 s.d. Minggu, 26 Mei 2024",
  bulanan "Bulan Mei 2024").
- Berkas disimpan sementara di `export_data/dirrequest`, dikirim melalui WA
  dengan MIME Excel, lalu dihapus otomatis setelah pengiriman berhasil agar
  direktori tetap bersih.
- Jika pengiriman gagal, bot tetap mengirim pesan error lewat helper
  `safeSendMessage` untuk mencegah *unhandled rejection* ketika WA client belum
  siap.

## Monitoring Satbinmas Official
Grup menu terbaru di bagian bawah menambahkan alur khusus untuk memantau akun
resmi Satbinmas. Menu utama kini menampilkan rentang opsi **3️⃣6️⃣–4️⃣1️⃣** untuk
alur ini sehingga operator bisa langsung memilih pengambilan data maupun
rekap.

- **3️⃣6️⃣ Ambil metadata harian IG Satbinmas Official**
  1. Pilih opsi **3️⃣6️⃣** dari menu dirrequest.
  2. Bot menampilkan prompt *Monitoring Satbinmas Official* yang otomatis
     memakai *Client ID* aktif (default `DITBINMAS`).
  3. Balas dengan format `username` atau `CLIENT_ID username` jika ingin
     mengecek akun Satbinmas milik client lain. Contoh: `satbinmas_official`
  atau `MKS01 satbinmas_official`.
  4. Bot memanggil layanan RapidAPI (`fetchInstagramInfo`) untuk menarik
     metadata profil Instagram (nama, followers, postingan, status verifikasi,
     dan privasi).
  5. Hasil dikirim kembali ke operator dalam satu pesan ringkasan. Jika
     metadata tidak ditemukan atau layanan gagal diakses, bot menampilkan pesan
     kegagalan beserta alasan singkat.
  6. Balasan `batal` kapan pun akan menutup alur ini dan kembali ke menu utama
     dirrequest.

- **3️⃣7️⃣ Ambil konten harian IG Satbinmas Official**
  1. Pilih opsi **3️⃣7️⃣**. Bot langsung mengeksekusi tanpa menunggu balasan.
  2. Sistem otomatis memuat seluruh akun Instagram Satbinmas Official untuk
     setiap client bertipe `ORG` dari tabel `satbinmas_official_accounts`
     (tanpa filter `is_active`), dieksekusi berurutan per client dengan jeda
     agar tidak melanggar rate limit RapidAPI.
  3. RapidAPI Instagram dipanggil melalui
     `fetchTodaySatbinmasOfficialMediaForOrgClients` untuk menarik konten hari
     berjalan (filter `taken_at` hari ini) dan menormalkan metadata, termasuk
     hashtag dan mention ke tabel terpisah.
  4. Operator menerima rekap harian yang memuat periode pengambilan data,
     total polres/akun/konten (tanpa rincian baru/update/gagal), daftar akun
     aktif (urutan konten tertinggi) lengkap dengan total likes dan komentar
     per akun, akun pasif, serta client ORG yang belum pernah memasukkan akun
     Satbinmas Official. Nama polres dipakai apabila tersedia agar mudah
     dibaca. Rekap tetap memuat daftar akun yang gagal diproses jika ada.

- **3️⃣8️⃣ Sinkronisasi secUid TikTok Satbinmas Official**
  1. Pilih opsi **3️⃣8️⃣** untuk memicu sinkronisasi otomatis tanpa perlu
     membalas username.
  2. Bot mengambil seluruh akun TikTok Satbinmas Official dari tabel
     `satbinmas_official_accounts` milik *semua* client bertipe `ORG`, lalu
     memanggil RapidAPI TikTok (`fetchTiktokProfile`) satu per satu untuk
     menarik `secUid` terbaru dengan jeda aman.
  3. Setiap hasil sukses disimpan kembali ke kolom `secuid` melalui layanan
     `syncSatbinmasOfficialTiktokSecUidForOrgClients`, sementara kegagalan
     (username kosong, konflik, atau RapidAPI error) dicatat dalam ringkasan.
  4. Operator menerima rekap agregat (jumlah client, akun berhasil, akun gagal)
     beserta daftar client tanpa akun TikTok yang terdaftar.

- **3️⃣9️⃣ Ambil konten harian TikTok Satbinmas Official**
  1. Pilih opsi **3️⃣9️⃣**. Bot langsung mengeksekusi tanpa menunggu balasan.
  2. Sistem otomatis memuat seluruh akun TikTok Satbinmas Official untuk setiap
     client bertipe `ORG` dari tabel `satbinmas_official_accounts` dan mengeksekusi
     berurutan per client dengan jeda agar aman dari batas RapidAPI.
  3. RapidAPI TikTok dipanggil melalui
     `fetchTodaySatbinmasOfficialTiktokMediaForOrgClients` untuk menarik konten
     yang dibuat hari ini (berdasarkan `createTime`).
  4. Seluruh profil, konten, dan hashtag tersimpan di tabel
     `satbinmas_tiktok_accounts`, `satbinmas_tiktok_posts`, dan
     `satbinmas_tiktok_post_hashtags`.
  5. Operator menerima rekap otomatis dengan format baru: periode pengambilan
     data, total polres/akun/konten, daftar akun aktif (urutan konten tertinggi
     beserta likes dan komentar per akun), akun pasif, serta client ORG yang
     belum memiliki akun TikTok terdaftar. Kegagalan per akun juga dicantumkan.

- **4️⃣0️⃣ Rekap Instagram Satbinmas Official**
  1. Pilih opsi **4️⃣0️⃣** untuk membuka submenu rekap.
  2. Bot menampilkan pilihan periode: **1. Harian** (hari ini), **2. Mingguan**
     (Senin–Minggu berjalan), dan **3. Bulanan** (tanggal 1 s/d akhir bulan
     berjalan).
  3. Balasan angka **1–3** hanya membaca rekap yang sudah ada di tabel
     `satbinmas_official_media`; tidak ada pemanggilan RapidAPI.
  4. Operator menerima ringkasan berformat sama dengan rekap harian: klasifikasi
     akun aktif/pasif/belum input dengan label periode, total konten, beserta
     total likes dan komentar per akun.
  5. Balasan `batal`, `0`, atau `kembali` menutup submenu dan kembali ke menu
     utama tanpa menjalankan proses apa pun.

- **4️⃣1️⃣ Rekap TikTok Satbinmas Official**
  1. Pilih opsi **4️⃣1️⃣** untuk membuka submenu rekap TikTok.
  2. Submenu menawarkan periode **1. Harian** (hari ini), **2. Mingguan**
     (Senin–Minggu berjalan), dan **3. Bulanan** (tanggal 1 s/d akhir bulan
     berjalan) yang semuanya memakai data tersimpan di tabel
     `satbinmas_tiktok_posts` yang terhubung lewat `secUid` akun Satbinmas
     Official.
  3. Tidak ada pemanggilan RapidAPI; rekap dibangun dari agregasi data lokal
     (total konten, likes, komentar per akun) dan tetap menandai akun yang
     belum memiliki `secUid` tersinkron.
  4. Hasil dikirim sebagai pesan ringkasan ke operator. Balasan `batal`, `0`,
  atau `kembali` akan menutup submenu dan kembali ke menu utama.

- **Catatan pemanggilan data**
  - Menu **3️⃣7️⃣** dan **3️⃣9️⃣** tetap menjalankan pengambilan konten via
    RapidAPI (Instagram/TikTok) sebelum disimpan dan diringkas.
  - Menu rekap **4️⃣0️⃣** dan **4️⃣1️⃣** tidak memanggil RapidAPI; outputnya murni
    berasal dari data yang sudah tersimpan di database.

Opsi ini membantu Ditbinmas memantau kesiapan akun resmi Satbinmas tanpa harus
berpindah ke dashboard web atau menjalankan skrip manual.

## Rekap Instagram All Data (Menu 4️⃣2️⃣)
- Rentang bulan selalu dimulai dari **September** (tahun berjalan) dan
  otomatis mundur ke September tahun sebelumnya bila bulan saat ini belum
  memasuki September. Rekap berhenti pada bulan berjalan.
- Setiap bulan memanggil `getRekapLikesByClient(clientId, 'bulanan', <YYYY-MM>,
  null, null, roleFlag)` dan mengakumulasikan `jumlah_like` per `client_name`
  (polres). Nama polres dipakai langsung dari kolom `client_name` hasil query.
- Excel disusun sebagai array-of-arrays dengan kolom: `Polres`, satu kolom per
  bulan (nama bulan Indonesia + tahun), serta kolom `Total` per polres. Baris
  `TOTAL` di bagian akhir menjumlahkan seluruh polres per bulan sekaligus
  grand total.
- Judul dan periode pada baris pertama serta kedua digabung (merged), header
  dibekukan (`freeze`) bersama kolom Polres, dan `!cols` dihitung dari panjang
  teks terpanjang di setiap kolom agar lebar menyesuaikan isi.
- Sel angka diformat memakai `#,##0` (locale Indonesia) sehingga ribuan
  menggunakan pemisah yang mudah dibaca, termasuk pada kolom total.
- Berkas disimpan di `export_data/dirrequest` dengan format nama
  `<CLIENT>_Rekap_Instagram_All_Data_<tanggal>_<jam>.xlsx`, dikirim ke WA via
  `sendWAFile`, lalu dihapus begitu pengiriman selesai.

## Rekap TikTok All Data (Menu 4️⃣3️⃣)
- Tujuan: merangkum jumlah komentar TikTok per polres untuk setiap bulan mulai
  **September** hingga bulan saat ini dengan otomatis mundur ke September tahun
  sebelumnya bila eksekusi dilakukan sebelum September.
- Per bulan, layanan memanggil
  `getRekapKomentarByClient(clientId, 'bulanan', <YYYY-MM>, null, null, roleFlag)`
  dan menjumlahkan `jumlah_komentar` per `client_name` (polres) untuk menghasilkan
  kolom **Total** per polres.
- Baris polres diurutkan berdasarkan total komentar terbanyak ke paling sedikit,
  lalu diurutkan alfabetis jika totalnya sama. Baris terakhir adalah `TOTAL` yang
  menjumlahkan setiap kolom bulan serta grand total komentar.
- Struktur Excel mengikuti rekap Instagram all data: baris judul dan periode
  digabung (merged), header dibekukan (`freeze`) bersama kolom `Polres`, dan
  lebar kolom dihitung dari isi terpanjang agar mudah dibaca.
- Sel angka memakai format `#,##0` (locale Indonesia). Nama file mengikuti pola
  `<CLIENT>_Rekap_TikTok_All_Data_<tanggal>_<jam>.xlsx` dan dikirim ke WA lewat
  `sendWAFile` sebelum berkas sementara dihapus.

## Automasi Cron Ditbinmas Group Recap
- Cron `cronDirRequestDitbinmasGroupRecap.js` berjalan setiap hari pukul
  **15:10** dan **18:14 WIB** untuk menjalankan menu **2️⃣1️⃣** dan **2️⃣2️⃣**
  dengan pilihan periode **hari ini**.
- Pengiriman hanya ke Group WhatsApp Ditbinmas (`client_group`). Super Admin,
  Operator, maupun admin WhatsApp lain tidak menjadi target penerima.
- Menu **2️⃣2️⃣** memakai rekap ranking engagement periode *today* sehingga file
  Excel yang dikirim selalu mengacu pada data hari berjalan.

## Automasi Cron Ditbinmas Super Admin Harian
- Cron `cronDirRequestDitbinmasSuperAdminDaily.js` berjalan setiap hari pukul
  **18:10 WIB** untuk menjalankan menu **6**, **9**, **3️⃣4️⃣**, dan **3️⃣5️⃣**
  dengan pilihan data **hari ini**.
- Rekap hanya dikirim ke daftar Super Admin Ditbinmas (`client_super`) tanpa
  broadcast ke grup atau operator.

## Automasi Cron Ditbinmas Operator Harian
- Cron `cronDirRequestDitbinmasOperatorDaily.js` berjalan setiap hari pukul
  **18:12 WIB** untuk menjalankan menu **3️⃣0️⃣** dengan pilihan data
  **hari ini**.
- Rekap hanya dikirim ke daftar Operator Ditbinmas (`client_operator`) tanpa
  broadcast ke grup maupun Super Admin.

## Automasi Cron DITINTELKAM Pagi
- Cron `cronDirRequestDitintelkamMorning.js` berjalan setiap hari pukul
  **07:10 WIB** untuk menjalankan menu **1️⃣** dan **3️⃣** khusus
  client `DITINTELKAM`.
- Pengiriman hanya ke Group WhatsApp DITINTELKAM (`client_group`) agar
  rekap pagi fokus untuk kanal komando grup direktorat.

## Automasi Cron DITINTELKAM Rutin
- Cron `cronDirRequestDitintelkamRoutine.js` berjalan setiap hari pada
  **10:09, 12:09, 14:09, 16:09, 18:09, 20:09, dan 22:09 WIB** untuk
  mengeksekusi menu **6️⃣** dan **9️⃣** pada client `DITINTELKAM`.
- Pengiriman dilakukan ke tiga target penerima berdasarkan data client:
  **group** (`client_group`), **operator** (`client_operator`), dan
  **super admin** (`client_super`).
- Daftar penerima dideduplikasi otomatis; nomor/ID yang tidak valid dilewati
  dan dicatat ke log `[SKIP WA] invalid recipient`.
- Filter personel untuk menu **6️⃣** dan **9️⃣** kini menerima role direktorat
  `ditintelkam` pada query `getUsersByDirektorat`, sehingga pengelompokan
  pengguna tidak lagi gagal dengan pesan *Direktorat flag tidak valid*.

## Automasi Cron BIDHUMAS Malam
- Cron `cronDirRequestBidhumasEvening.js` berjalan setiap hari pukul
  **22:00 WIB**. Urutan eksekusi: menjalankan menu **6** (Instagram likes),
  **9** (komentar TikTok), **2️⃣8️⃣** (rekap likes per konten), dan **2️⃣9️⃣**
  (rekap komentar per konten) khusus untuk client `BIDHUMAS` tanpa langkah fetch
  post/engagement tambahan di awal.
  **Super Admin** dan **Operator** tidak lagi dipakai untuk cron ini.
- Client Direktorat yang tidak memiliki group valid akan dilewati sehingga
  tidak ada pesan broadcast keluar.
- Seluruh **log proses** cron tetap dikirim ke nomor **ADMIN_WHATSAPP** untuk
  pemantauan admin, sementara pesan tugas/respons hanya dikirim ke Group WA
  per client.
- Pesan tugas **menggunakan nama client** pada salam pembuka (contoh: BID
  HUMAS) sehingga tidak lagi terpaku pada label Ditbinmas.
- Jika akun Direktorat belum memiliki relasi `insta_post_roles`, cron akan
  otomatis membaca konten berdasarkan `client_id` agar daftar tugas tidak
  kosong (misalnya pada client BID HUMAS).
- Cron peringkat, rekap, serta kirim ulang tugas (Engage Rank, Sosmed Rank,
  High/Low, Kasat Binmas, Kasatker, dan Rekap All Sosmed) **dihentikan** sehingga
  hanya pengambilan konten dasar dan pengingat tugas otomatis yang berjalan
  dari bucket dirRequest.
- Pengingat otomatis `cronWaNotificationReminder` tetap berjalan untuk pengguna
  Ditbinmas maupun BIDHUMAS yang mendaftar melalui `notifwa#on` dan masih
  dikirim ke nomor personal sesuai preferensi opt-in. Status pengiriman harian disimpan di tabel
  `wa_notification_reminder_state` (key: `date_key`, `chat_id`, `client_id`) **hanya setelah pesan berhasil terkirim**,
  sehingga penerima yang sudah tercatat selesai untuk tiap client tidak dikirimi ulang pada eksekusi berikutnya di
  hari yang sama, sementara penerima yang belum lengkap tetap maju ke tahap
  follow-up berikutnya dan pengiriman yang gagal akan dicoba kembali pada run berikutnya.

### Format Nomor Super Admin & Operator
- Kolom `client_super` dan `client_operator` menerima:
  - Nomor lokal dengan awalan `0`, misalnya `0812-3456-7890` → distandarkan ke
    `6281234567890@c.us`.
  - Nomor internasional yang sudah berawalan `62`, misalnya `6281234567890` →
    tetap `6281234567890@c.us`.
  - WID yang sudah memiliki sufiks `@c.us` atau `@s.whatsapp.net` akan
    dipertahankan apa adanya selama digit angkanya valid.
- Token non-numerik (seperti `not-a-number`) atau nomor dengan digit kurang
  dari **8 angka** akan ditolak sehingga penerima tidak akan disertakan di
  daftar `recipients` cron. Saat terjadi, cron akan mencatat log
  `[SKIP WA] invalid recipient` untuk memudahkan penelusuran.

### Format Grup WA untuk DirRequest
- Kolom `client_group` menerima beberapa variasi input untuk grup Ditbinmas dan
  Direktorat lain:
  - ID grup penuh seperti `120363419830216549@g.us` (huruf besar/kecil diabaikan).
  - ID numerik tanpa sufiks seperti `120363419830216549`, yang otomatis akan
    ditambahkan `@g.us` ketika pola ID grup valid.
  - Tautan undangan WhatsApp seperti
    `https://chat.whatsapp.com/invite/120363419830216549` atau
    `https://chat.whatsapp.com/120363419830216549`; bagian undangan akan dibuang
    dan token numerik di ujung akan dipakai.
- Spasi di awal/akhir akan dihilangkan sebelum validasi. Hanya token numerik
  sepanjang 10–22 digit yang lolos dan diubah menjadi format standar
  `<ID>@g.us`; token lain atau undangan dengan kode huruf akan diabaikan sehingga
  laporan untuk client tersebut tidak dikirim.

## RapidAPI (Instagram & TikTok)
- Opsi pengambilan konten (**3️⃣6️⃣**, **3️⃣7️⃣**, **3️⃣8️⃣**, **3️⃣9️⃣**) membutuhkan
  kredensial RapidAPI. Pastikan variabel lingkungan `RAPIDAPI_KEY` terisi
  sebelum bot dijalankan.
- TikTok memakai host `tiktok-api23.p.rapidapi.com` melalui
  `fetchTiktokProfile` untuk mengambil `secUid`. Instagram memakai host yang
  sama via fungsi `fetchInstagramInfo` dan `fetchInstagramPosts`.
- Menu rekap (**4️⃣0️⃣**, **4️⃣1️⃣**) hanya membaca database sehingga tetap dapat
  dipakai ketika RapidAPI tidak tersedia, selama data konten sudah ada di
  tabel yang disebutkan di atas.
