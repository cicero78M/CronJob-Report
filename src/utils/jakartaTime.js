export const JAKARTA_TIME_ZONE = "Asia/Jakarta";
export const JAKARTA_UTC_OFFSET = "+07:00";
const JAKARTA_WEEKDAY_TO_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function safeDate(value = new Date()) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function getJakartaDateParts(value = new Date()) {
  const date = safeDate(value);
  if (!date) return null;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
    weekday: map.weekday,
  };
}

export function getJakartaNow() {
  const timestamp = formatJakartaIsoTimestamp(new Date());
  return timestamp ? new Date(timestamp) : new Date();
}

export function toJakartaDateKey(value = new Date()) {
  const parts = getJakartaDateParts(value);
  if (!parts) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getJakartaDayIndex(value = new Date()) {
  const parts = getJakartaDateParts(value);
  if (!parts?.weekday) return null;
  return JAKARTA_WEEKDAY_TO_INDEX[parts.weekday] ?? null;
}

export function formatJakartaDate(value = new Date(), options = {}) {
  return formatJakartaLocale(value, "id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...options,
  });
}

export function formatJakartaTime(value = new Date(), options = {}) {
  return formatJakartaLocale(value, "id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...options,
  });
}

export function formatJakartaDateTime(value = new Date(), dateOptions = {}, timeOptions = {}) {
  const datePart = formatJakartaDate(value, dateOptions);
  const timePart = formatJakartaTime(value, timeOptions);
  if (!datePart || !timePart) return null;
  return `${datePart} ${timePart}`;
}

export function formatJakartaIsoDate(value = new Date()) {
  return toJakartaDateKey(value);
}

export function formatJakartaIsoTimestamp(value = new Date()) {
  const parts = getJakartaDateParts(value);
  if (!parts) return null;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${JAKARTA_UTC_OFFSET}`;
}

export function formatJakartaLocale(value = new Date(), locale = "id-ID", options = {}) {
  const date = safeDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(locale, {
    timeZone: JAKARTA_TIME_ZONE,
    ...options,
  }).format(date);
}

export function getJakartaHour(value = new Date()) {
  const parts = getJakartaDateParts(value);
  if (!parts) return null;
  return Number(parts.hour);
}
