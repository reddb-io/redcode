"use client";
import { jsx } from "react/jsx-runtime";
import { input } from "../../src/input.variants.js";
import { inputValue } from "../../src/core/input.js";
import { useAccessibleControl } from "./use-accessible-control.js";
import { resolveFieldSize } from "../../src/core/field-size.js";
function Input({ size, controlSize: legacySize, htmlSize, type, value, className, onChange, onValueChange, ref, ...rest }) {
  const element = useAccessibleControl("Input", ref);
  const field = resolveFieldSize("Input", { size, controlSize: legacySize, htmlSize });
  return /* @__PURE__ */ jsx(
    "input",
    {
      ...rest,
      size: field.htmlSize,
      ref: element,
      type,
      value: value === null ? "" : value,
      className: input({ size: field.size, class: className }),
      onChange: (event) => {
        const next = inputValue(event.currentTarget);
        onChange?.(event);
        onValueChange?.(next);
      }
    }
  );
}
export {
  Input
};
