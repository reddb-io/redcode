"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { Calendar } from "./Calendar.js";
import { DateField } from "./DateField.js";
import { Popover } from "./Popover.js";
import { datePicker } from "../../src/date-picker.variants.js";
import { parseCalendarDate } from "../../src/core/calendar.js";
import { useNativeFormReset, useValue } from "./state.js";
function DatePicker(props) {
  const { label, calendarLabel, triggerLabel = `Choose ${label}`, name, value = "", help, error, required = false, disabled = false, id, open = false, placeholder, minValue, maxValue, isDateUnavailable, side, align, sideOffset, collisionPadding, trigger, className, fieldClass, segmentClass, triggerClass, contentClass, calendarClass, navigationClass, dayClass, onValueChange, onOpenChange } = props;
  const [current, setCurrent, resetCurrent] = useValue(props.value, value, onValueChange), [active, setActive] = useValue(props.open, open, onOpenChange), styles = datePicker();
  const root = useRef(null), initial = useRef(value);
  useNativeFormReset(root, () => resetCurrent(props.value ?? initial.current));
  const selected = parseCalendarDate(current);
  return /* @__PURE__ */ jsxs("div", { ref: root, "data-date-picker": true, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx(DateField, { label, name, value: current, onValueChange: setCurrent, help, error, required, disabled, id, className: styles.field({ class: fieldClass }), segmentClass }),
    /* @__PURE__ */ jsx(Popover, { triggerLabel, contentLabel: calendarLabel, open: active, onOpenChange: setActive, disabled, side, align, sideOffset, collisionPadding, trigger, triggerClass: styles.trigger({ class: triggerClass }), className: styles.content({ class: contentClass }), children: /* @__PURE__ */ jsx(Calendar, { label: calendarLabel, value: selected, placeholder: placeholder ?? selected, minValue, maxValue, isDateUnavailable, disabled, onValueChange: (next) => {
      if (next) {
        setCurrent(next.toString());
        setActive(false);
      }
    }, className: styles.calendar({ class: calendarClass }), navigationClass, dayClass }) })
  ] });
}
export {
  DatePicker
};
