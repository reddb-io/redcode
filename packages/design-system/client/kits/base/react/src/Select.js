"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { useAccessibleControl } from "./use-accessible-control.js";
import { select } from "../../src/select.variants.js";
import { writeSelectValue } from "../../src/core/choices.js";
import { afterFormReset } from "../../src/core/native-controls.js";
import { resolveFieldSize } from "../../src/core/field-size.js";
function Select({ options = [], value, size, controlSize: legacySize, htmlSize, className, children, onChange, onValueChange, ref, ...rest }) {
  const element = useAccessibleControl("Select", ref);
  const field = resolveFieldSize("Select", { size, controlSize: legacySize, htmlSize });
  const supplied = useRef(value);
  supplied.current = value;
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
      size: field.htmlSize,
      ref: element,
      value,
      className: select({ size: field.size, class: className }),
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
