"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { endOfMonth, getDayOfWeek, isSameDay, isSameMonth, startOfMonth } from "@internationalized/date";
import { Button } from "./Button.js";
import { calendar } from "../../src/calendar.variants.js";
import { quietControl } from "../../src/quiet-control.variants.js";
import { calendarDirection, calendarDisabled, calendarKeyTarget, calendarMonths, currentCalendarDate } from "../../src/core/calendar.js";
import { useValue } from "./state.js";
function CalendarSurface(props) {
  const { label, selection, range = false, onSelect, placeholder, onPlaceholderChange, disabled = false, readonly = false, locale = "en", weekStartsOn = 0, weekdayFormat = "short", fixedWeeks = true, numberOfMonths = 1, pagedNavigation = false, disableDaysOutsideMonth = false, initialFocus = false, monthFormat = "long", yearFormat = "numeric", navigationClass, dayClass, minValue, maxValue, isDateDisabled, isDateUnavailable, preventDeselect: _preventDeselect, className, ref: forwardedRef, ...rest } = props;
  const initial = useRef(placeholder ?? selection.start ?? currentCalendarDate());
  const [shown, setShown] = useValue(placeholder, initial.current, onPlaceholderChange), [focused, setFocused] = useState(selection.start ?? initial.current), [hovered, setHovered] = useState();
  const root = useRef(null), pendingFocus = useRef(false), id = useId(), styles = calendar();
  useImperativeHandle(forwardedRef, () => root.current, []);
  const months = calendarMonths(shown, numberOfMonths, weekStartsOn, fixedWeeks, locale), first = months[0].month, last = months.at(-1).month;
  const same = (a, b) => !!a && !!b && isSameDay(a, b);
  const dateLabel = (day) => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC", calendar: day.calendar.identifier }).format(day.toDate("UTC"));
  const monthLabel = (day) => `${typeof monthFormat === "function" ? monthFormat(day.month) : new Intl.DateTimeFormat(locale, { month: monthFormat, timeZone: "UTC", calendar: day.calendar.identifier }).format(day.toDate("UTC"))} ${typeof yearFormat === "function" ? yearFormat(day.year) : new Intl.DateTimeFormat(locale, { year: yearFormat, timeZone: "UTC", calendar: day.calendar.identifier }).format(day.toDate("UTC"))}`;
  const title = months.map(({ month }) => monthLabel(month)).join(" \u2013 "), rtl = calendarDirection(locale) === "rtl";
  const available = months.flatMap(({ month, days }) => days.filter((day) => isSameMonth(day, month) && !calendarDisabled(day, props)));
  const tabDay = available.find((day) => same(day, focused)) ?? available.find((day) => same(day, selection.start)) ?? available[0];
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      pendingFocus.current = false;
      root.current?.querySelector(`[data-calendar-date="${focused}"]:not([data-outside-month])`)?.focus();
    }
  }, [focused, shown]);
  useEffect(() => {
    if (initialFocus) root.current?.querySelector('[data-calendar-date][tabindex="0"]')?.focus();
  }, []);
  const move = (next2) => {
    setFocused(next2);
    pendingFocus.current = true;
    if (next2.compare(first) < 0 || next2.compare(endOfMonth(last)) > 0) setShown(startOfMonth(next2));
  };
  const step = Math.max(1, pagedNavigation ? numberOfMonths : 1);
  const previous = first.subtract({ months: step }), next = first.add({ months: step });
  const prevDisabled = disabled || !!minValue && endOfMonth(first.subtract({ months: 1 })).compare(minValue) < 0;
  const nextDisabled = disabled || !!maxValue && startOfMonth(last.add({ months: 1 })).compare(maxValue) > 0;
  const previewEnd = range && selection.start && !selection.end ? hovered : selection.end;
  const lower = selection.start && previewEnd && selection.start.compare(previewEnd) > 0 ? previewEnd : selection.start;
  const upper = selection.start && previewEnd && selection.start.compare(previewEnd) > 0 ? selection.start : previewEnd;
  return /* @__PURE__ */ jsxs("div", { ...rest, ref: root, ...range ? { "data-range-calendar": "" } : { "data-calendar": "" }, "aria-label": `${label}, ${title}`, role: "group", dir: rtl ? "rtl" : "ltr", className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsxs("div", { className: styles.header(), children: [
      /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", disabled: prevDisabled, "aria-label": "Previous month", className: styles.navigation({ class: navigationClass }), onClick: () => setShown(previous), children: /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\u2190" }) }),
      /* @__PURE__ */ jsx("div", { id: `${id}-heading`, className: styles.heading(), "aria-live": "polite", children: title }),
      /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", disabled: nextDisabled, "aria-label": "Next month", className: styles.navigation({ class: navigationClass }), onClick: () => setShown(next), children: /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\u2192" }) })
    ] }),
    /* @__PURE__ */ jsx("div", { className: styles.months(), children: months.map(({ month, days }, monthIndex) => /* @__PURE__ */ jsxs("table", { role: "grid", "aria-readonly": readonly || void 0, "aria-label": `${label}, ${monthLabel(month)}`, "aria-multiselectable": range || void 0, className: styles.grid(), children: [
      /* @__PURE__ */ jsx("thead", { className: styles.gridHead(), children: /* @__PURE__ */ jsx("tr", { className: styles.gridRow(), children: days.slice(0, 7).map((day) => /* @__PURE__ */ jsx("th", { scope: "col", className: styles.headCell(), children: new Intl.DateTimeFormat(locale, { weekday: weekdayFormat, timeZone: "UTC" }).format(day.toDate("UTC")) }, getDayOfWeek(day, locale))) }) }),
      /* @__PURE__ */ jsx("tbody", { children: Array.from({ length: days.length / 7 }, (_, week) => /* @__PURE__ */ jsx("tr", { className: styles.gridRow(), children: days.slice(week * 7, week * 7 + 7).map((day) => {
        const outside = !isSameMonth(day, month), inert = calendarDisabled(day, props) || outside && disableDaysOutsideMonth, unavailable = !!isDateUnavailable?.(day);
        const selected = range ? !!lower && !!upper && day.compare(lower) >= 0 && day.compare(upper) <= 0 : same(day, selection.start);
        return /* @__PURE__ */ jsx("td", { role: "gridcell", "aria-selected": selected, "aria-disabled": inert || void 0, className: styles.cell(), children: /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            "data-calendar-date": day.toString(),
            "data-value": day.toString(),
            "data-month-index": monthIndex,
            "data-selected": selected ? "" : void 0,
            "data-disabled": inert ? "" : void 0,
            "data-unavailable": unavailable ? "" : void 0,
            "data-outside-month": outside ? "" : void 0,
            "data-today": same(day, currentCalendarDate()) ? "" : void 0,
            "data-range-start": range && same(day, lower) ? "" : void 0,
            "data-range-end": range && same(day, upper) ? "" : void 0,
            "data-range-middle": range && selected && !same(day, lower) && !same(day, upper) ? "" : void 0,
            disabled: inert,
            "aria-label": dateLabel(day),
            "aria-invalid": unavailable && selected || void 0,
            tabIndex: !outside && same(day, tabDay) && !inert ? 0 : -1,
            className: quietControl({ ink: "inherit", class: styles.day({ class: dayClass }) }),
            onFocus: () => setFocused(day),
            onPointerEnter: () => setHovered(day),
            onClick: () => {
              if (!readonly && !inert && !unavailable) {
                setFocused(day);
                onSelect(day);
              }
            },
            onKeyDown: (event) => {
              const target = calendarKeyTarget(day, event.key, props, event.shiftKey, rtl);
              if (target) {
                event.preventDefault();
                move(target);
              }
            },
            children: new Intl.NumberFormat(locale, { useGrouping: false }).format(day.day)
          }
        ) }, day.toString());
      }) }, week)) })
    ] }, month.toString())) })
  ] });
}
export {
  CalendarSurface
};
