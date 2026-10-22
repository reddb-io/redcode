"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Field } from "./Field.js";
import { slider } from "../../src/slider.variants.js";
import { rangeValue } from "../../src/core/slider.js";
import { afterFormReset, associatedForm } from "../../src/core/native-controls.js";
function Slider({ label, help, error, required = false, id, value, defaultValue = 0, onValueChange, min = 0, max = 100, step = 1, formatValue, className, fieldClass, outputClass, ref, onChange, ...rest }) {
  const initial = useRef(rangeValue(value ?? defaultValue, min, max, step));
  const [local, setLocal] = useState(initial.current);
  const current = rangeValue(value ?? local, min, max, step), formatted = formatValue ? formatValue(current) : String(current);
  const element = useRef(null);
  const latest = useRef({ value, current });
  latest.current = { value, current };
  useImperativeHandle(ref, () => element.current, []);
  useLayoutEffect(() => {
    if (element.current && element.current.valueAsNumber !== current) element.current.value = String(current);
  });
  useEffect(() => afterFormReset(associatedForm(element.current, rest.form), () => {
    if (latest.current.value === void 0) setLocal(initial.current);
    if (element.current) element.current.value = String(latest.current.value === void 0 ? initial.current : latest.current.current);
  }), [rest.form]);
  const styles = slider();
  return /* @__PURE__ */ jsx("div", { className: styles.root(), "data-slider": true, children: /* @__PURE__ */ jsx(Field, { label, help, error, required, id, className: fieldClass, children: (control) => /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      "input",
      {
        ...rest,
        ...control,
        ref: element,
        type: "range",
        min,
        max,
        step,
        defaultValue: initial.current,
        "aria-valuetext": formatValue ? formatted : void 0,
        className: styles.control({ class: className }),
        onChange: (event) => {
          const next = event.currentTarget.valueAsNumber;
          onChange?.(event);
          if (value === void 0) setLocal(next);
          onValueChange?.(next);
          if (value !== void 0 && element.current) element.current.value = String(current);
        }
      }
    ),
    /* @__PURE__ */ jsx("output", { className: styles.output({ class: outputClass }), htmlFor: control.id, "aria-live": "polite", children: formatted })
  ] }) }) });
}
export {
  Slider
};
