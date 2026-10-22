import { getDayOfWeek, getLocalTimeZone, parseDate, startOfMonth, today } from "@internationalized/date";
function parseCalendarDate(value) {
  try {
    return value ? parseDate(value) : void 0;
  } catch {
    return void 0;
  }
}
function currentCalendarDate() {
  return today(getLocalTimeZone());
}
function calendarMonths(date, count, weekStart, fixed, locale) {
  return Array.from({ length: Math.max(1, Math.trunc(count) || 1) }, (_, index) => {
    const month = startOfMonth(date.add({ months: index }));
    const first = month.subtract({ days: (getDayOfWeek(month, locale, "sun") - weekStart + 7) % 7 });
    const length = fixed ? 42 : Math.ceil(((getDayOfWeek(month, locale, "sun") - weekStart + 7) % 7 + month.calendar.getDaysInMonth(month)) / 7) * 7;
    return { month, days: Array.from({ length }, (_2, index2) => first.add({ days: index2 })) };
  });
}
function calendarDisabled(date, options) {
  return !!(options.disabled || options.minValue && date.compare(options.minValue) < 0 || options.maxValue && date.compare(options.maxValue) > 0 || options.isDateDisabled?.(date));
}
function calendarRangeValid(start, end, options) {
  const length = end.calendar.toJulianDay(end) - start.calendar.toJulianDay(start) + 1;
  if (length < (options.minDays ?? 1) || length > (options.maxDays ?? Infinity)) return false;
  if (options.excludeDisabled) for (let day = start; day.compare(end) <= 0; day = day.add({ days: 1 })) {
    if (calendarDisabled(day, options) || options.isDateUnavailable?.(day)) return false;
  }
  return true;
}
function calendarKeyTarget(date, key, options, shift = false, rtl = false) {
  const weekStart = options.weekStartsOn ?? 0, weekday = getDayOfWeek(date, options.locale ?? "en", "sun");
  let next = key === "ArrowLeft" ? date.add({ days: rtl ? 1 : -1 }) : key === "ArrowRight" ? date.add({ days: rtl ? -1 : 1 }) : key === "ArrowUp" ? date.subtract({ days: 7 }) : key === "ArrowDown" ? date.add({ days: 7 }) : key === "Home" ? date.subtract({ days: (weekday - weekStart + 7) % 7 }) : key === "End" ? date.add({ days: 6 - (weekday - weekStart + 7) % 7 }) : key === "PageUp" ? date.subtract(shift ? { years: 1 } : { months: 1 }) : key === "PageDown" ? date.add(shift ? { years: 1 } : { months: 1 }) : void 0;
  if (!next || options.disabled) return void 0;
  if (options.minValue && next.compare(options.minValue) < 0) next = options.minValue;
  if (options.maxValue && next.compare(options.maxValue) > 0) next = options.maxValue;
  const step = next.compare(date) >= 0 ? 1 : -1;
  for (let attempt = 0; attempt < 366; attempt++) {
    if (!calendarDisabled(next, options)) return next;
    next = next.add({ days: step });
    if (options.minValue && next.compare(options.minValue) < 0 || options.maxValue && next.compare(options.maxValue) > 0) return void 0;
  }
  return void 0;
}
function calendarDirection(locale) {
  const info = new Intl.Locale(locale);
  return (info.getTextInfo?.().direction ?? info.textInfo?.direction ?? (/^(ar|fa|he|ur)(-|$)/.test(locale) ? "rtl" : "ltr")) === "rtl" ? "rtl" : "ltr";
}
function calendarLocale(locale, date) {
  return date ? new Intl.Locale(locale, { calendar: date.calendar.identifier }).toString() : locale;
}
export {
  calendarDirection,
  calendarDisabled,
  calendarKeyTarget,
  calendarLocale,
  calendarMonths,
  calendarRangeValid,
  currentCalendarDate,
  parseCalendarDate
};
