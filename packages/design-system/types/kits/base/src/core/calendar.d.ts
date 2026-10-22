import { type DateValue } from "@internationalized/date";
/** A range can be incomplete while its second bound is being chosen. */
export interface CalendarRange {
    start: DateValue | undefined;
    end: DateValue | undefined;
}
/** Calendar semantics independent of either headless rendering implementation. */
export interface CalendarContract {
    /** Base accessible name; the visible month and year are appended. */
    label: string;
    /** Month shown when no value is selected; moves with keyboard or month navigation. */
    placeholder?: DateValue;
    /** Earliest selectable date. */
    minValue?: DateValue;
    /** Latest selectable date. */
    maxValue?: DateValue;
    /** Prevent focus and selection of every date and navigation control. */
    disabled?: boolean;
    /** Permit navigation and focus without changing selection. */
    readonly?: boolean;
    /** Prevent clearing a selected date by selecting it again. */
    preventDeselect?: boolean;
    /** Mark individual dates disabled and exclude them from keyboard focus. */
    isDateDisabled?: (date: DateValue) => boolean;
    /** Mark dates unavailable for selection. */
    isDateUnavailable?: (date: DateValue) => boolean;
    /** Locale for calendar labels, date announcements and right-to-left direction. */
    locale?: string;
    /** First weekday, Sunday=0 through Saturday=6. */
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    /** Width of weekday names; defaults to short. */
    weekdayFormat?: Intl.DateTimeFormatOptions["weekday"];
    /** Render six weeks per month to keep the height stable. Defaults to true. */
    fixedWeeks?: boolean;
    /** Number of simultaneous months; defaults to one. */
    numberOfMonths?: number;
    /** Move by the number of visible months rather than one month. */
    pagedNavigation?: boolean;
    /** Disable dates drawn outside each grid's named month. */
    disableDaysOutsideMonth?: boolean;
    /** Formatting of the visible month name. */
    monthFormat?: Intl.DateTimeFormatOptions["month"] | ((month: number) => string);
    /** Formatting of the visible year. */
    yearFormat?: Intl.DateTimeFormatOptions["year"] | ((year: number) => string);
    /** Extra classes merged onto both month navigation controls. */
    navigationClass?: string;
    /** Extra classes merged onto every day control. */
    dayClass?: string;
}
export declare function parseCalendarDate(value?: string): DateValue | undefined;
export declare function currentCalendarDate(): import("@internationalized/date").CalendarDate;
export declare function calendarMonths(date: DateValue, count: number, weekStart: number, fixed: boolean, locale: string): {
    month: DateValue;
    days: (import("@internationalized/date").CalendarDate | import("@internationalized/date").CalendarDateTime | import("@internationalized/date").ZonedDateTime)[];
}[];
export declare function calendarDisabled(date: DateValue, options: Pick<CalendarContract, "disabled" | "minValue" | "maxValue" | "isDateDisabled">): boolean;
export declare function calendarRangeValid(start: DateValue, end: DateValue, options: CalendarContract & {
    minDays?: number;
    maxDays?: number;
    excludeDisabled?: boolean;
}): boolean;
/** Arrow/day, week-edge and month/year moves; disabled dates are skipped within the bounds. */
export declare function calendarKeyTarget(date: DateValue, key: string, options: CalendarContract, shift?: boolean, rtl?: boolean): DateValue | undefined;
/** Resolve text direction for language and script locales across modern Intl implementations. */
export declare function calendarDirection(locale: string): "ltr" | "rtl";
/** Keep a DateValue's calendar identity when a renderer derives its calendar from locale. */
export declare function calendarLocale(locale: string, date: DateValue | undefined): string;
