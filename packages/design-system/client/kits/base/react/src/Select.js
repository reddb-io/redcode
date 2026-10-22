"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useImperativeHandle, useRef } from "react";
import { select } from "../../src/select.variants.js";
import { writeSelectValue } from "../../src/core/choices.js";
import { afterFormReset } from "../../src/core/native-controls.js";
function Select({ options = [], value, controlSize = "md", className, children, onChange, onValueChange, ref, ...rest }) {
  const element = useRef(null);
  const supplied = useRef(value);
  supplied.current = value;
  useImperativeHandle(ref, () => element.current, []);
  useEffect(() => {
    if (element.current && value !== void 0) writeSelectValue(element.current, value);
  }, [value, options, children, rest.multiple]);
  useEffect(() => afterFormReset(element.current?.form, () => {
    if (element.current && supplied.current !== void 0) writeSelectValue(element.current, supplied.current);
  }), [rest.form]);
  return /* @__PURE__ */ jsxs(
    "select",
    {
      ...rest,
      ref: element,
      value,
      className: select({ size: controlSize, class: className }),
      onChange: (event) => {
        const next = event.currentTarget.value;
        onChange?.(event);
        onValueChange?.(next);
      },
      children: [
        options.map((option) => /* @__PURE__ */ jsx("option", { value: option.value, disabled: option.disabled, children: option.label }, option.value)),
        children
      ]
    }
  );
}
export {
  Select
};
