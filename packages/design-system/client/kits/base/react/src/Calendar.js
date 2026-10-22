"use client";
import { jsx } from "react/jsx-runtime";
import { CalendarSurface } from "./CalendarSurface.js";
import { useValue } from "./state.js";
function Calendar(props) {
  const { value, onValueChange, preventDeselect = false, weekdayFormat = "short", fixedWeeks = true, ...rest } = props;
  const [selected, setSelected] = useValue(props.value, value, onValueChange);
  return /* @__PURE__ */ jsx(CalendarSurface, { ...rest, preventDeselect, weekdayFormat, fixedWeeks, selection: { start: selected, end: void 0 }, onSelect: (date) => setSelected(!preventDeselect && selected?.compare(date) === 0 ? void 0 : date) });
}
export {
  Calendar
};
