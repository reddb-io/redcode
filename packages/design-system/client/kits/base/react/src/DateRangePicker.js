"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { DateRangeField } from "./DateRangeField.js";
import { RangeCalendar } from "./RangeCalendar.js";
import { Popover } from "./Popover.js";
import { dateRangePicker } from "../../src/date-range-picker.variants.js";
import { parseCalendarDate } from "../../src/core/calendar.js";
import { useNativeFormReset, useValue } from "./state.js";
function DateRangePicker(props) {
  const { label, startLabel, endLabel, calendarLabel, triggerLabel = `Choose ${label}`, startName, endName, startValue = "", endValue = "", help, rangeError, required = false, disabled = false, id, open = false, placeholder, minValue, maxValue, minDays, maxDays, isDateUnavailable, side, align, sideOffset, collisionPadding, trigger, className, fieldClass, dateFieldClass, segmentClass, triggerClass, contentClass, calendarClass, navigationClass, dayClass, onValueChange, onOpenChange } = props;
  const [start, setStart, resetStart] = useValue(props.startValue, startValue), [end, setEnd, resetEnd] = useValue(props.endValue, endValue), [active, setActive] = useValue(props.open, open, onOpenChange), styles = dateRangePicker();
  const root = useRef(null), initial = useRef({ startValue, endValue });
  useNativeFormReset(root, () => {
    resetStart(props.startValue ?? initial.current.startValue);
    resetEnd(props.endValue ?? initial.current.endValue);
  });
  const value = { start: parseCalendarDate(start), end: parseCalendarDate(end) };
  return /* @__PURE__ */ jsxs("div", { ref: root, "data-date-range-picker": true, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx(DateRangeField, { label, startLabel, endLabel, startName, endName, startValue: start, endValue: end, help, rangeError, required, disabled, id, className: styles.field({ class: fieldClass }), fieldClass: dateFieldClass, segmentClass, onValueChange: (next) => {
      setStart(next.start);
      setEnd(next.end);
      onValueChange?.(next);
    } }),
    /* @__PURE__ */ jsx(Popover, { triggerLabel, contentLabel: calendarLabel, open: active, onOpenChange: setActive, disabled, side, align, sideOffset, collisionPadding, trigger, triggerClass: styles.trigger({ class: triggerClass }), className: contentClass, children: /* @__PURE__ */ jsx(RangeCalendar, { label: calendarLabel, value, placeholder: placeholder ?? value.start, minValue, maxValue, minDays, maxDays, isDateUnavailable, disabled, onValueChange: (next) => {
      setStart(next.start?.toString() ?? "");
      setEnd(next.end?.toString() ?? "");
      if (next.start && next.end) {
        onValueChange?.({ start: next.start.toString(), end: next.end.toString() });
        setActive(false);
      }
    }, className: styles.calendar({ class: calendarClass }), navigationClass, dayClass }) })
  ] });
}
export {
  DateRangePicker
};
