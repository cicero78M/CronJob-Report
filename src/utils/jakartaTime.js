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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toUtcDateFromIsoDate(isoDate) {
  return safeDate(`${isoDate}T00:00:00Z`);
}

function addUtcDays(date, dayOffset) {
  const base = safeDate(date);
  if (!base) return null;
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + dayOffset);
  return next;
}

function toIsoDateFromJakartaParts(parts) {
  if (!parts) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildRangeResult(mode, startIsoDate, endIsoDate) {
  const startDate = toUtcDateFromIsoDate(startIsoDate);
  const endDate = toUtcDateFromIsoDate(endIsoDate);
  return {
    mode,
    startDate,
    endDate,
    startIsoDate,
    endIsoDate,
  };
}


function shiftIsoDate(isoDate, dayOffset) {
  const date = toUtcDateFromIsoDate(isoDate);
  const shifted = addUtcDays(date, dayOffset);
  return shifted ? shifted.toISOString().slice(0, 10) : null;
}

export function getJakartaAttendanceWindow(referenceDate = new Date()) {
  const referenceDateKey = toJakartaDateKey(referenceDate);
  if (!referenceDateKey) {
    const fallbackStartJakarta = "1970-01-01 17:00:00";
    const fallbackEndJakarta = "1970-01-02 16:59:59";
    const fallbackStartUtc = new Date("1970-01-01T10:00:00.000Z");
    const fallbackEndUtc = new Date("1970-01-02T09:59:59.000Z");
    return {
      referenceDateKey: "1970-01-02",
      startJakarta: fallbackStartJakarta,
      endJakarta: fallbackEndJakarta,
      startJakartaIso: "1970-01-01T17:00:00+07:00",
      endJakartaIso: "1970-01-02T16:59:59+07:00",
      startUtcDate: fallbackStartUtc,
      endUtcDate: fallbackEndUtc,
      startUtcIso: fallbackStartUtc.toISOString(),
      endUtcIso: fallbackEndUtc.toISOString(),
    };
  }

  const previousDateKey = shiftIsoDate(referenceDateKey, -1) || referenceDateKey;
  const startJakartaIso = `${previousDateKey}T17:00:00${JAKARTA_UTC_OFFSET}`;
  const endJakartaIso = `${referenceDateKey}T16:59:59${JAKARTA_UTC_OFFSET}`;
  const startUtcDate = new Date(startJakartaIso);
  const endUtcDate = new Date(endJakartaIso);

  return {
    referenceDateKey,
    startJakarta: `${previousDateKey} 17:00:00`,
    endJakarta: `${referenceDateKey} 16:59:59`,
    startJakartaIso,
    endJakartaIso,
    startUtcDate,
    endUtcDate,
    startUtcIso: startUtcDate.toISOString(),
    endUtcIso: endUtcDate.toISOString(),
  };
}

export function getJakartaDailyRecapWindow(referenceDate = new Date()) {
  const referenceDateKey = toJakartaDateKey(referenceDate);
  if (!referenceDateKey) {
    const fallbackStartJakarta = "1970-01-01 00:01:00";
    const fallbackEndJakarta = "1970-01-01 00:01:00";
    const fallbackStartUtc = new Date("1969-12-31T17:01:00.000Z");
    const fallbackEndUtc = new Date("1969-12-31T17:01:00.000Z");
    return {
      referenceDateKey: "1970-01-01",
      startJakarta: fallbackStartJakarta,
      endJakarta: fallbackEndJakarta,
      startJakartaIso: "1970-01-01T00:01:00+07:00",
      endJakartaIso: "1970-01-01T00:01:00+07:00",
      startUtcDate: fallbackStartUtc,
      endUtcDate: fallbackEndUtc,
      startUtcIso: fallbackStartUtc.toISOString(),
      endUtcIso: fallbackEndUtc.toISOString(),
    };
  }

  const referenceParts = getJakartaDateParts(referenceDate);
  const endClock = referenceParts
    ? `${referenceParts.hour}:${referenceParts.minute}:${referenceParts.second}`
    : "00:01:00";
  const startJakartaIso = `${referenceDateKey}T00:01:00${JAKARTA_UTC_OFFSET}`;
  const endJakartaIso = `${referenceDateKey}T${endClock}${JAKARTA_UTC_OFFSET}`;
  const startUtcDate = new Date(startJakartaIso);
  const endUtcDate = new Date(endJakartaIso);

  return {
    referenceDateKey,
    startJakarta: `${referenceDateKey} 00:01:00`,
    endJakarta: `${referenceDateKey} ${endClock}`,
    startJakartaIso,
    endJakartaIso,
    startUtcDate,
    endUtcDate,
    startUtcIso: startUtcDate.toISOString(),
    endUtcIso: endUtcDate.toISOString(),
  };
}

export function isWithinJakartaAttendanceWindow(value, referenceDate = new Date()) {
  const date = safeDate(value);
  if (!date) return false;
  const window = getJakartaAttendanceWindow(referenceDate);
  if (!window?.startUtcDate || !window?.endUtcDate) return false;
  return date >= window.startUtcDate && date <= window.endUtcDate;
}
export function getJakartaDayRange(value = new Date()) {
  const isoDate = toJakartaDateKey(value);
  if (!isoDate) {
    return buildRangeResult("day", "1970-01-01", "1970-01-01");
  }
  return buildRangeResult("day", isoDate, isoDate);
}

export function getJakartaWeekRange({ mode = "this_week", value = new Date() } = {}) {
  const todayIso = toJakartaDateKey(value);
  if (!todayIso) {
    return buildRangeResult(mode, "1970-01-01", "1970-01-01");
  }

  const dayIndex = getJakartaDayIndex(value);
  const todayDate = toUtcDateFromIsoDate(todayIso);
  const thisWeekEnd =
    dayIndex === 0 ? todayDate : addUtcDays(todayDate, -1 * (dayIndex || 0));
  const resolvedWeekEnd =
    mode === "last_week" ? addUtcDays(thisWeekEnd, -7) : thisWeekEnd;
  const resolvedWeekStart = addUtcDays(resolvedWeekEnd, -6);

  const startIsoDate = formatJakartaIsoDate(resolvedWeekStart);
  const endIsoDate = formatJakartaIsoDate(resolvedWeekEnd);
  return buildRangeResult(mode, startIsoDate, endIsoDate);
}

export function getJakartaMonthRange({ mode = "this_month", value = new Date() } = {}) {
  const parts = getJakartaDateParts(value);
  if (!parts) {
    return buildRangeResult(mode, "1970-01-01", "1970-01-01");
  }

  let targetYear = Number(parts.year);
  let targetMonth = Number(parts.month);

  if (mode === "last_month") {
    targetMonth -= 1;
    if (targetMonth < 1) {
      targetMonth = 12;
      targetYear -= 1;
    }
  }

  const startIsoDate = `${targetYear}-${pad2(targetMonth)}-01`;
  let endIsoDate;
  if (mode === "this_month") {
    endIsoDate = toIsoDateFromJakartaParts(parts);
  } else {
    const nextMonthYear = targetMonth === 12 ? targetYear + 1 : targetYear;
    const nextMonth = targetMonth === 12 ? 1 : targetMonth + 1;
    const firstNextMonth = toUtcDateFromIsoDate(
      `${nextMonthYear}-${pad2(nextMonth)}-01`
    );
    const lastDayTargetMonth = addUtcDays(firstNextMonth, -1);
    endIsoDate = formatJakartaIsoDate(lastDayTargetMonth);
  }

  return buildRangeResult(mode, startIsoDate, endIsoDate);
}
