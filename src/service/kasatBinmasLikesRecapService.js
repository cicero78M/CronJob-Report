import { getRekapLikesByClient } from "../model/instaLikeModel.js";
import { formatNama } from "../utils/utilsHelper.js";
import { buildKasatBinmasRoster } from "./kasatBinmasRosterService.js";
import { formatJakartaDate, formatJakartaLocale, getJakartaDayIndex, toJakartaDateKey } from "../utils/jakartaTime.js";
import { 
  getPositionIndex, 
  getRankIndex 
} from "../utils/sortingHelper.js";

const DITBINMAS_CLIENT_ID = "DITBINMAS";
const TARGET_ROLE = "ditbinmas";
const MENU34_TASK_SCOPE = "hybrid";

const STATUS_SECTIONS = [
  { key: "lengkap", icon: "✅", label: "Melaksanakan Lengkap" },
  { key: "kurang", icon: "⚠️", label: "Melaksanakan Sebagian" },
  { key: "belum", icon: "❌", label: "Belum Melaksanakan" },
  { key: "noUsername", icon: "⚠️❌", label: "Belum Update Username Instagram" },
  { key: "noActiveAccount", icon: "🚫", label: "Belum Tersedia Akun Aktif Kasat Binmas" },
];

function toDateInput(date) {
  return toJakartaDateKey(date) || "1970-01-01";
}

function formatDateLong(date) {
  return formatJakartaDate(date, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDayLabel(date) {
  return formatJakartaLocale(date, "id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function resolveWeeklyRange(baseDate = new Date()) {
  const date = new Date(baseDate.getTime());
  const day = getJakartaDayIndex(date) ?? date.getDay(); // 0=Sunday
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getTime());
  monday.setDate(date.getDate() + mondayDiff);
  const sunday = new Date(monday.getTime());
  sunday.setDate(sunday.getDate() + 6);
  return {
    start: monday,
    end: sunday,
    label: `${formatDayLabel(monday)} s.d. ${formatDayLabel(sunday)}`,
  };
}

export function describeKasatBinmasLikesPeriod(period = "daily", referenceDate) {
  const baseDate = referenceDate ? new Date(referenceDate) : new Date();
  const today = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  if (period === "weekly") {
    const { start, end, label } = resolveWeeklyRange(today);
    return {
      type: "mingguan",
      label,
      startDate: toDateInput(start),
      endDate: toDateInput(end),
      title: "Mingguan",
    };
  }
  if (period === "monthly") {
    const label = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      month: "long",
      year: "numeric",
    }).format(today);
    return {
      type: "bulanan",
      label: `Bulan ${label}`,
      tanggal: (toJakartaDateKey(today) || "1970-01-01").slice(0, 7),
      title: "Bulanan",
    };
  }
  return {
    type: "harian",
    label: formatDayLabel(today),
    tanggal: toDateInput(today),
    title: "Harian",
  };
}

function formatUserEntry(user, count, totalKonten) {
  const name = formatNama(user) || "(Tanpa Nama)";
  const polres = (user?.client_name || user?.client_id || "-").toUpperCase();
  if (!user?.insta) {
    return `${name} (${polres}) — Username IG belum tersedia`;
  }
  if (totalKonten === 0) {
    return `${name} (${polres}) — Belum ada konten untuk di-like`;
  }
  return `${name} (${polres}) — ${count}/${totalKonten} konten`;
}

function groupKasatByStatus(kasatList, likeCounts, totalKonten) {
  const totals = { total: kasatList.length, lengkap: 0, kurang: 0, belum: 0, noUsername: 0 };
  const grouped = { lengkap: [], kurang: [], belum: [], noUsername: [] };

  kasatList.forEach((user) => {
    let status = "noUsername";
    let count = 0;
    if (user?.insta) {
      const userCount = Number(likeCounts.get(user.user_id)) || 0;
      count = userCount;
      if (totalKonten > 0) {
        if (userCount >= totalKonten) status = "lengkap";
        else if (userCount > 0) status = "kurang";
        else status = "belum";
      } else {
        status = "belum";
      }
    }

    totals[status] += 1;
    grouped[status].push({ user, count });
  });

  return { totals, grouped };
}

function formatMissingPolres(client) {
  const polres = String(client?.nama || client?.client_id || "Polres tidak diketahui").toUpperCase();
  return `${polres} — Belum tersedia akun aktif Kasat Binmas`;
}

function sortKasatList(entries) {
  return entries.slice().sort((a, b) => {
    const countDiff = (b.count || 0) - (a.count || 0);
    if (countDiff !== 0) return countDiff;
    
    // Sort by position (jabatan) first
    const positionDiff = getPositionIndex(a.user?.jabatan) - getPositionIndex(b.user?.jabatan);
    if (positionDiff !== 0) return positionDiff;
    
    // Then sort by rank (pangkat)
    const rankDiff = getRankIndex(a.user?.title) - getRankIndex(b.user?.title);
    if (rankDiff !== 0) return rankDiff;
    
    // Finally sort by name
    const nameA = formatNama(a.user) || "";
    const nameB = formatNama(b.user) || "";
    return nameA.localeCompare(nameB, "id-ID", { sensitivity: "base" });
  });
}

export async function generateKasatBinmasLikesRecap({
  /**
   * Periode rekap likes:
   * - daily => harian (menggunakan parameter `tanggal`)
   * - weekly => mingguan (menggunakan parameter `startDate` dan `endDate`)
   * - monthly => bulanan (menggunakan parameter `tanggal` format YYYY-MM)
   */
  period = "daily",
  referenceDate,
} = {}) {
  const periodInfo = describeKasatBinmasLikesPeriod(period, referenceDate);

  const roster = await buildKasatBinmasRoster();
  const kasatUsers = roster.activeKasatUsers;

  if (!kasatUsers.length && roster.totalPolres === 0) {
    return `Dari ${roster.totalPolres} Polres jajaran, belum tersedia akun aktif Kasat Binmas.`;
  }

  const { rows, totalKonten: totalKontenRaw } = await getRekapLikesByClient(
    DITBINMAS_CLIENT_ID,
    periodInfo.type,
    periodInfo.tanggal,
    periodInfo.startDate,
    periodInfo.endDate,
    TARGET_ROLE,
    {
      taskScope: MENU34_TASK_SCOPE,
      enableDiagnostics: true,
      diagnosticsLabel: 'generateKasatBinmasLikesRecap',
    }
  );
  const totalKonten = Number(totalKontenRaw) || 0;
  const likeCounts = new Map();
  (rows || []).forEach((row) => {
    if (!row) return;
    likeCounts.set(row.user_id, Number(row.jumlah_like) || 0);
  });

  if (totalKonten === 0) {
    return [
      `*LAPORAN ${periodInfo.type === "bulanan" ? "BULANAN" : periodInfo.type === "mingguan" ? "MINGGUAN" : "HARIAN"} ABSENSI MEDIA SOSIAL*`,
      "*KASAT BINMAS JAJARAN POLDA JAWA TIMUR*",
      "",
      "📋 *Absensi Engagement Kasat Binmas*",
      "🏢 Satuan: Ditbinmas Polda Jawa Timur",
      "📱 Platform: Instagram",
      "📝 Aktivitas: Likes dan Komentar",
      `🗓️ Periode: ${periodInfo.label}`,
      "━━━━━━━━━━━━━━━━━━━━",
      "",
      "Belum ada konten Instagram Ditbinmas pada periode ini untuk diabsen.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const { totals, grouped } = groupKasatByStatus(kasatUsers, likeCounts, totalKonten);
  totals.total = roster.totalPolres;
  totals.noActiveAccount = roster.missingPolres.length;
  grouped.noActiveAccount = roster.missingPolres.map((client) => ({ client }));

  const sectionsText = STATUS_SECTIONS.map(({ key, icon, label }) => {
    const entries = sortKasatList(grouped[key] || []);
    const header = `${icon} *${label} (${entries.length} pers)*`;
    if (!entries.length) {
      return `${header}\n  - Tidak ada data`;
    }
    const list = entries
      .map(
        (entry, idx) =>
          `  ${idx + 1}. ${key === "noActiveAccount" ? formatMissingPolres(entry.client) : formatUserEntry(entry.user, entry.count, totalKonten)}`
      )
      .join("\n");
    return `${header}\n${list}`;
  }).join("\n\n");

  const summaryLines = [
    `*LAPORAN ${periodInfo.type === "bulanan" ? "BULANAN" : periodInfo.type === "mingguan" ? "MINGGUAN" : "HARIAN"} ABSENSI MEDIA SOSIAL*`,
    "*KASAT BINMAS JAJARAN POLDA JAWA TIMUR*",
    "",
    "📋 *Absensi Engagement Kasat Binmas*",
    "🏢 Satuan: Ditbinmas Polda Jawa Timur",
    "📱 Platform: Instagram",
    "📝 Aktivitas: Likes dan Komentar",
    `🗓️ Periode: ${periodInfo.label}`,
    "━━━━━━━━━━━━━━━━━━━━",
    `📈 Total konten periode ini: ${totalKonten}`,
    `🏢 Total Polres jajaran: ${roster.totalPolres}`,
    `👥 Kasat Binmas dengan akun aktif: ${roster.totalActiveKasat} pers`,
    "",
    "📊 Distribusi Status:",
    `  ✅ Lengkap: ${totals.lengkap} pers`,
    `  ⚠️ Sebagian: ${totals.kurang} pers`,
    `  ❌ Belum: ${totals.belum} pers`,
    `  ⚠️❌ Belum update username IG: ${totals.noUsername} pers`,
    `  🚫 Belum tersedia akun aktif Kasat Binmas: ${totals.noActiveAccount} Polres`,
    "",
    sectionsText,
  ];

  return summaryLines.filter(Boolean).join("\n");
}

export default { generateKasatBinmasLikesRecap };
