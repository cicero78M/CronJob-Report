const REGION_KEYWORDS = [
  'POLRES',
  'POLDA',
  'POLRESTA',
  'POLTABES',
  'POLSEK',
  'KOTA',
  'KAB',
  'KABUPATEN',
  'RESORT',
  'WILAYAH',
];
const REGION_REGEX = new RegExp(`\\b(${REGION_KEYWORDS.join('|')})\\b`, 'g');
const KASAT_BINMAS_REGEX = /^KASAT\s*BINMAS\b/;

function sanitizeJabatanText(jabatan = '') {
  if (!jabatan) return '';

  return jabatan
    .toString()
    .replace(/[.,/:;\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(REGION_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesKasatBinmasJabatan(jabatan) {
  const normalized = sanitizeJabatanText(jabatan).replace(/\s+/g, ' ');
  return normalized.startsWith('KASAT') && KASAT_BINMAS_REGEX.test(normalized);
}

export default { matchesKasatBinmasJabatan };
