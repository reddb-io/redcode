"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "./Button.js";
import { Field } from "./Field.js";
import { Input } from "./Input.js";
import { numberField } from "../../src/number-field.variants.js";
import { numberConstraints } from "../../src/core/number-field.js";
import { afterFormReset, associatedForm } from "../../src/core/native-controls.js";
function NumberField({ label, value, defaultValue = null, onValueChange, min, max, step = 1, help, error, controlSize = "md", decrementLabel, incrementLabel, id, required = false, disabled = false, readOnly = false, className, ref, ...rest }) {
  const initial = useRef(value === void 0 ? defaultValue : value);
  const [local, setLocal] = useState(initial.current);
  const current = value === void 0 ? local : value;
  const latest = useRef({ value, current, onValueChange });
  latest.current = { value, current, onValueChange };
  const element = useRef(null);
  useImperativeHandle(ref, () => element.current, []);
  const constraints = numberConstraints(min, max, step), slots = numberField();
  useLayoutEffect(() => {
    if (element.current && element.current.value !== (current === null ? "" : String(current))) element.current.value = current === null ? "" : String(current);
  });
  useEffect(() => afterFormReset(associatedForm(element.current, rest.form), () => {
    if (latest.current.value === void 0) setLocal(initial.current);
    latest.current.onValueChange?.(initial.current);
    const next = latest.current.value === void 0 ? initial.current : latest.current.current;
    if (element.current) element.current.value = next === null ? "" : String(next);
  }), [rest.form]);
  function update(next) {
    if (value === void 0) setLocal(next);
    onValueChange?.(next);
    if (value !== void 0 && element.current) element.current.value = value === null ? "" : String(value);
  }
  function move(direction) {
    const input = element.current;
    if (!input || input.disabled || input.matches(":disabled") || readOnly) return;
    const before = input.value;
    if (direction === 1) input.stepUp();
    else input.stepDown();
    if (input.value === before) return;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return /* @__PURE__ */ jsx(Field, { label, help, error, required, id, className, children: (control) => /* @__PURE__ */ jsxs("div", { "data-number-field": true, className: slots.root(), children: [
    /* @__PURE__ */ jsx(Button, { size: controlSize, variant: "secondary", className: slots.step(), "aria-label": decrementLabel ?? `Decrease ${label}`, disabled: disabled || readOnly || current !== null && min !== void 0 && current <= min, onClick: () => move(-1), children: "\u2212" }),
    /* @__PURE__ */ jsx(Input, { ...rest, ...control, ...constraints, type: "number", defaultValue: initial.current ?? "", disabled, readOnly, controlSize, ref: element, onValueChange: update, className: slots.input() }),
    /* @__PURE__ */ jsx(Button, { size: controlSize, variant: "secondary", className: slots.step(), "aria-label": incrementLabel ?? `Increase ${label}`, disabled: disabled || readOnly || current !== null && max !== void 0 && current >= max, onClick: () => move(1), children: "+" })
  ] }) });
}
export {
  NumberField
};
