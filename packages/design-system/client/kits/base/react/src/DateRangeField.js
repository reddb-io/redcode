"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef } from "react";
import { DateField } from "./DateField.js";
import { Fieldset } from "./Fieldset.js";
import { dateRangeField } from "../../src/date-range-field.variants.js";
import { afterFormReset } from "../../src/core/native-controls.js";
import { useValue } from "./state.js";
function DateRangeField(props) {
  const { label, startLabel, endLabel, startName, endName, startValue = "", endValue = "", onValueChange, help, rangeError = "End date cannot be before start date.", required = false, disabled = false, id, className, fieldClass, segmentClass } = props;
  const [start, setStart] = useValue(props.startValue, startValue), [end, setEnd] = useValue(props.endValue, endValue), uid = useId(), element = useRef(null);
  const initial = useRef({ startValue, endValue }), controlled = useRef(props);
  controlled.current = props;
  useEffect(() => afterFormReset(element.current?.form, () => {
    if (controlled.current.startValue === void 0) setStart(initial.current.startValue);
    if (controlled.current.endValue === void 0) setEnd(initial.current.endValue);
  }), [setStart, setEnd]);
  const inverted = Boolean(start && end && end < start), prefix = id ?? `${uid}-range`, helpId = `${prefix}-help`, errorId = `${prefix}-error`, styles = dateRangeField();
  const describedBy = [help ? helpId : void 0, inverted ? errorId : void 0].filter(Boolean).join(" ") || void 0;
  return /* @__PURE__ */ jsx(Fieldset, { ref: element, legend: label, disabled, className: styles.root({ class: className }), "data-date-range-field": true, "aria-describedby": describedBy, "aria-invalid": inverted ? "true" : void 0, children: () => /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { className: styles.frame(), "data-range-field-frame": true, children: /* @__PURE__ */ jsxs("div", { className: styles.fields(), "data-date-range-fields": true, children: [
      /* @__PURE__ */ jsx(DateField, { label: startLabel, name: startName, value: start, onValueChange: (next) => {
        setStart(next);
        onValueChange?.({ start: next, end });
      }, id: `${prefix}-start`, required, disabled, className: fieldClass, segmentClass }),
      /* @__PURE__ */ jsx(DateField, { label: endLabel, name: inverted ? void 0 : endName, value: end, onValueChange: (next) => {
        setEnd(next);
        onValueChange?.({ start, end: next });
      }, id: `${prefix}-end`, required, disabled, className: fieldClass, segmentClass })
    ] }) }),
    help && /* @__PURE__ */ jsx("p", { className: styles.help(), id: helpId, children: help }),
    inverted && /* @__PURE__ */ jsx("p", { className: styles.error(), id: errorId, role: "alert", children: rangeError })
  ] }) });
}
export {
  DateRangeField
};
