"use client";
import { jsx } from "react/jsx-runtime";
import { calendarRangeValid } from "../../src/core/calendar.js";
import { CalendarSurface } from "./CalendarSurface.js";
import { useValue } from "./state.js";
function RangeCalendar(props) {
  const { value, onValueChange, onStartValueChange, onEndValueChange, minDays, maxDays, excludeDisabled = false, weekdayFormat = "short", fixedWeeks = true, ...rest } = props;
  const [selected, setSelected] = useValue(value, value ?? { start: void 0, end: void 0 }, onValueChange);
  return /* @__PURE__ */ jsx(CalendarSurface, { ...rest, weekdayFormat, fixedWeeks, range: true, selection: selected, onSelect: (date) => {
    if (selected.end?.compare(date) === 0 && !props.preventDeselect) {
      setSelected({ start: void 0, end: void 0 });
      onStartValueChange?.(void 0);
      onEndValueChange?.(void 0);
      return;
    }
    if (!selected.start || selected.end) {
      setSelected({ start: date, end: void 0 });
      onStartValueChange?.(date);
      onEndValueChange?.(void 0);
      return;
    }
    const next = date.compare(selected.start) < 0 ? { start: date, end: selected.start } : { start: selected.start, end: date };
    if (selected.start.compare(date) === 0 && !props.preventDeselect) {
      setSelected({ start: void 0, end: void 0 });
      onStartValueChange?.(void 0);
      onEndValueChange?.(void 0);
      return;
    }
    if (!calendarRangeValid(next.start, next.end, props)) {
      setSelected({ start: date, end: void 0 });
      onStartValueChange?.(date);
      onEndValueChange?.(void 0);
      return;
    }
    setSelected(next);
    onStartValueChange?.(next.start);
    onEndValueChange?.(next.end);
  } });
}
export {
  RangeCalendar
};
