"use client";
import { jsx } from "react/jsx-runtime";
import { input } from "../../src/input.variants.js";
import { inputValue } from "../../src/core/input.js";
function Input({ controlSize = "md", type, value, className, onChange, onValueChange, ...rest }) {
  return /* @__PURE__ */ jsx(
    "input",
    {
      ...rest,
      type,
      value: value === null ? "" : value,
      className: input({ size: controlSize, class: className }),
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
