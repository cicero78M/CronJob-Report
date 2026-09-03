import { getCommentsByVideoId } from "../model/tiktokCommentModel.js";
import { getPostsTodayByClient } from "../model/tiktokPostModel.js";
import { getRekapKomentarByClient } from "../model/tiktokCommentModel.js";
import { formatNama } from "../utils/utilsHelper.js";
import { buildKasatBinmasRoster } from "./kasatBinmasRosterService.js";
import { toJakartaDateKey } from "../utils/jakartaTime.js";
import {
  extractUsernamesFromComments,
  normalizeUsername,
} from "../handler/fetchabsensi/tiktok/absensiKomentarTiktok.js";

const DITBINMAS_CLIENT_ID = "DITBINMAS";
const TARGET_ROLE = "ditbinmas";

const STATUS_SECTIONS = [
  { key: "lengkap", icon: "✅", label: "Lengkap (sesuai target)" },
  { key: "sebagian", icon: "🟡", label: "Sebagian (belum semua konten)" },
  { key: "belum", icon: "❌", label: "Belum komentar" },
  { key: "noUsername", icon: "⚠️❌", label: "Belum update akun TikTok" },
  { key: "noActiveAccount", icon: "🚫", label: "Belum tersedia akun aktif Kasat Binmas" },
];

const PANGKAT_ORDER = [
  "KOMISARIS BESAR POLISI",
  "AKBP",
  "KOMPOL",
  "AKP",
  "IPTU",
  "IPDA",
  "AIPTU",
  "AIPDA",
  "BRIPKA",
  "BRIGPOL",
  "BRIGADIR",
  "BRIGADIR POLISI",
  "BRIPTU",
  "BRIPDA",
];

function rankWeight(rank) {
  const normalized = String(rank || "").toUpperCase();
  const idx = PANGKAT_ORDER.indexOf(normalized);
  return idx === -1 ? PANGKAT_ORDER.length : idx;
}

function toJakartaDate(baseDate = new Date()) {
  const isoDate = toJakartaDateKey(baseDate);
  if (!isoDate) return new Date();
  return new Date(`${isoDate}T00:00:00Z`);
}

export function resolveBaseDate(referenceDate) {
  if (!referenceDate) {
    return toJakartaDate(new Date());
  }

  const candidateDate = new Date(referenceDate);
  if (Number.isNaN(candidateDate.getTime())) {
    return toJakartaDate(new Date());
  }

  const jakartaCandidate = toJakartaDate(candidateDate);
  const todayJakarta = toJakartaDate(new Date());
  if (jakartaCandidate.getTime() > todayJakarta.getTime()) {
    return todayJakarta;
  }

  return jakartaCandidate;
}

function toDateInput(date) {
  const zonedDate = date instanceof Date ? date : toJakartaDate(date);
  const year = zonedDate.getUTCFullYear();
  const month = String(zonedDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(zonedDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLong(date) {
  const jakartaDate = date instanceof Date ? date : toJakartaDate(date);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(jakartaDate);
}

function formatDayLabel(date) {
  const jakartaDate = date instanceof Date ? date : toJakartaDate(date);
  const weekday = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
  }).format(jakartaDate);
  return `${weekday}, ${formatDateLong(jakartaDate)}`;
}

function resolveWeeklyRange(baseDate = new Date()) {
  const date = baseDate instanceof Date ? baseDate : toJakartaDate(baseDate);
  const day = date.getUTCDay();
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getTime());
  monday.setUTCDate(date.getUTCDate() + mondayDiff);
  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: monday,
    end: sunday,
    label: `${formatDayLabel(monday)} s.d. ${formatDayLabel(sunday)}`,
  };
}

function describePeriod(period = "daily", referenceDate) {
  const today = resolveBaseDate(referenceDate);
  if (period === "weekly") {
    const { start, end, label } = resolveWeeklyRange(today);
    return {
      periode: "mingguan",
      label,
      tanggal: toDateInput(start),
      startDate: toDateInput(start),
      endDate: toDateInput(end),
    };
  }
  if (period === "monthly") {
    const label = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      month: "long",
      year: "numeric",
    }).format(today);
    const zoned = today instanceof Date ? today : toJakartaDate(today);
    return {
      periode: "bulanan",
      label: `Bulan ${label}`,
      tanggal: `${zoned.getUTCFullYear()}-${String(zoned.getUTCMonth() + 1).padStart(2, "0")}`,
    };
  }
  return {
    periode: "harian",
    label: formatDayLabel(today),
    tanggal: toDateInput(today),
  };
}

export function describeKasatBinmasTiktokCommentPeriod(period = "daily", referenceDate) {
  return describePeriod(period, referenceDate);
}

function sortKasatEntries(entries) {
  return entries.slice().sort((a, b) => {
    const countA = Number(a.count) || 0;
    const countB = Number(b.count) || 0;
    const countDiff = countB - countA;
    if (countDiff !== 0) return countDiff;

    const rankDiff = rankWeight(a.user?.title) - rankWeight(b.user?.title);
    if (rankDiff !== 0) return rankDiff;

    const nameA = a.user
      ? formatNama(a.user)
      : String(a.client?.nama || a.client?.client_id || "");
    const nameB = b.user
      ? formatNama(b.user)
      : String(b.client?.nama || b.client?.client_id || "");
    return nameA.localeCompare(nameB, "id-ID", { sensitivity: "base" });
  });
}

function formatEntryLine(entry, index, totalKonten) {
  const user = entry.user;
  const polres = (user?.client_name || user?.client_id || "-").toUpperCase();
  const name = formatNama(user) || "(Tanpa Nama)";
  if (!user?.tiktok) {
    return `${index}. ${name} (${polres}) — Username TikTok belum tersedia`;
  }
  if (totalKonten === 0) {
    return `${index}. ${name} (${polres}) — Tidak ada konten untuk dikomentari`;
  }
  if (entry.count >= totalKonten) {
    return `${index}. ${name} (${polres}) — Lengkap (${entry.count}/${totalKonten} konten)`;
  }
  if (entry.count > 0) {
    return `${index}. ${name} (${polres}) — ${entry.count}/${totalKonten} konten`;
  }
  return `${index}. ${name} (${polres}) — 0/${totalKonten} konten`;
}

async function buildLiveFallbackCounts(kasatUsers, referenceDate) {
  const usernameToUsers = new Map();
  kasatUsers.forEach((user) => {
    const normalizedUsername = normalizeUsername(user?.tiktok);
    if (!normalizedUsername) return;
    if (!usernameToUsers.has(normalizedUsername)) {
      usernameToUsers.set(normalizedUsername, []);
    }
    usernameToUsers.get(normalizedUsername).push(user);
  });

  const commentCountByUser = new Map();
  try {
    const posts = await getPostsTodayByClient(
      DITBINMAS_CLIENT_ID,
      referenceDate
    );
    const totalKonten = posts.length;

    for (const post of posts) {
      try {
        const { comments } = await getCommentsByVideoId(post.video_id);
        const commenters = new Set(
          extractUsernamesFromComments(comments).map((uname) =>
            normalizeUsername(uname)
          )
        );

        commenters.forEach((username) => {
          const mappedUsers = usernameToUsers.get(username) || [];
          mappedUsers.forEach((user) => {
            commentCountByUser.set(
              user.user_id,
              (commentCountByUser.get(user.user_id) || 0) + 1
            );
          });
        });
      } catch (error) {
        return {
          success: false,
          totalKonten,
          commentCountByUser,
          error: `Gagal mengambil komentar untuk konten ${post.video_id}: ${
            error?.message || error
          }`,
        };
      }
    }

    return { success: true, totalKonten, commentCountByUser };
  } catch (error) {
    return {
      success: false,
      totalKonten: 0,
      commentCountByUser,
      error: error?.message || error,
    };
  }
}

export async function generateKasatBinmasTiktokCommentRecap({
  period = "daily",
  referenceDate,
} = {}) {
  const periodInfo = describePeriod(period, referenceDate);

  const roster = await buildKasatBinmasRoster();
  const kasatUsers = roster.activeKasatUsers;

  if (!kasatUsers.length && roster.totalPolres === 0) {
    return `Dari ${roster.totalPolres} Polres jajaran, belum tersedia akun aktif Kasat Binmas.`;
  }

  const recapRows = await getRekapKomentarByClient(
    DITBINMAS_CLIENT_ID,
    periodInfo.periode,
    periodInfo.tanggal,
    periodInfo.startDate,
    periodInfo.endDate,
    TARGET_ROLE
  );

  let commentCountByUser = new Map();
  let totalKonten = Number(recapRows?.[0]?.total_konten ?? 0);
  (recapRows || []).forEach((row) => {
    if (!row) return;
    commentCountByUser.set(row.user_id, Number(row.jumlah_komentar) || 0);
  });

  const allowLiveFallback = periodInfo.periode === "harian";
  let warningMessage = "";
  if (!recapRows?.length || totalKonten === 0) {
    if (allowLiveFallback) {
      const fallback = await buildLiveFallbackCounts(kasatUsers, periodInfo.tanggal);
      if (fallback.success) {
        commentCountByUser = fallback.commentCountByUser;
        totalKonten = fallback.totalKonten;
        warningMessage =
          totalKonten === 0
            ? "Rekap periode kosong. Tidak ada konten TikTok Ditbinmas hari ini untuk dicek secara langsung."
            : "Rekap periode kosong. Data diambil langsung dari konten TikTok hari ini.";
      } else if (!recapRows?.length) {
        return (
          "Rekap komentar periode ini tidak tersedia dan pengambilan data langsung juga gagal. " +
          (fallback.error ? `Alasan: ${fallback.error}` : "")
        ).trim();
      } else {
        warningMessage =
          fallback.error ||
          "Rekap komentar tidak tersedia untuk periode ini dan pengambilan data langsung gagal.";
      }
    } else if (!recapRows?.length) {
      warningMessage =
        "Rekap periode kosong. Tidak ada data komentar TikTok yang tersimpan untuk periode ini.";
    }
  }

  const grouped = { lengkap: [], sebagian: [], belum: [], noUsername: [], noActiveAccount: [] };
  const totals = {
    total: kasatUsers.length,
    lengkap: 0,
    sebagian: 0,
    belum: 0,
    noUsername: 0,
    noActiveAccount: roster.missingPolres.length,
  };

  kasatUsers.forEach((user) => {
    const count = commentCountByUser.get(user.user_id) || 0;
    let key = "belum";
    if (!user?.tiktok) {
      key = "noUsername";
    } else if (count >= totalKonten) {
      key = "lengkap";
    } else if (count > 0) {
      key = "sebagian";
    }

    totals[key] += 1;
    grouped[key].push({ user, count });
  });
  totals.total = roster.totalPolres;
  grouped.noActiveAccount = roster.missingPolres.map((client) => ({ client }));

  const sectionsText = STATUS_SECTIONS.map(({ key, icon, label }) => {
    const entries = sortKasatEntries(grouped[key] || []);
    const header = `${icon} *${label} (${entries.length} pers)*`;
    if (!entries.length) {
      return header;
    }
    const lines = entries.map((entry, idx) => {
      if (key === "noActiveAccount") {
        const polres = String(entry.client?.nama || entry.client?.client_id || "Polres tidak diketahui").toUpperCase();
        return `   ${idx + 1}. ${polres} — Belum tersedia akun aktif Kasat Binmas`;
      }
      return `   ${formatEntryLine(entry, idx + 1, totalKonten)}`;
    });
    return [header, ...lines].join("\n");
  });

  const sectionsWithSpacing = sectionsText.flatMap((section, index) =>
    index === sectionsText.length - 1 ? [section] : [section, ""]
  );

  const totalKontenLine =
    totalKonten > 0
      ? `Total konten periode: ${totalKonten} video`
      : "Total konten periode: 0 (tidak ada konten untuk dikomentari)";
  const noKontenNote =
    totalKonten === 0
      ? "Tidak ada konten yang perlu dikomentari pada periode ini. Status lengkap berarti tidak ada kewajiban komentar."
      : "";

  const summaryLines = [
    `*LAPORAN ${periodInfo.periode === "bulanan" ? "BULANAN" : periodInfo.periode === "mingguan" ? "MINGGUAN" : "HARIAN"} ABSENSI MEDIA SOSIAL*`,
    "*KASAT BINMAS JAJARAN POLDA JAWA TIMUR*",
    "",
    "📋 *Absensi Engagement Kasat Binmas*",
    "🏢 Satuan: Ditbinmas Polda Jawa Timur",
    "📱 Platform: TikTok",
    "📝 Aktivitas: Likes dan Komentar",
    `🗓️ Periode: ${periodInfo.label}`,
    "━━━━━━━━━━━━━━━━━━━━",
    warningMessage,
    "",
    "*Ringkasan:*",
    `- ${totalKontenLine}`,
    `- Total Polres jajaran: ${roster.totalPolres}`,
    `- Kasat Binmas dengan akun aktif: ${roster.totalActiveKasat} pers`,
    `- Lengkap: ${totals.lengkap}/${totals.total} pers`,
    `- Sebagian: ${totals.sebagian}/${totals.total} pers`,
    `- Belum komentar: ${totals.belum}/${totals.total} pers`,
    `- Belum update akun TikTok: ${totals.noUsername} pers`,
    `- Belum tersedia akun aktif Kasat Binmas: ${totals.noActiveAccount} Polres`,
    noKontenNote ? `- ${noKontenNote}` : "",
  ];

  return [
    ...summaryLines.filter(Boolean),
    "",
    "*Rincian per status:*",
    ...sectionsWithSpacing,
  ].join("\n");
}

export default { generateKasatBinmasTiktokCommentRecap, resolveBaseDate };
