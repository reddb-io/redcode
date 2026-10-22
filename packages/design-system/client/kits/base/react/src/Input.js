"use client";
import { jsx } from "react/jsx-runtime";
import { input } from "../../src/input.variants.js";
import { inputValue } from "../../src/core/input.js";
import { useAccessibleControl } from "./use-accessible-control.js";
function Input({ controlSize = "md", type, value, className, onChange, onValueChange, ref, ...rest }) {
  const element = useAccessibleControl("Input", ref);
  return /* @__PURE__ */ jsx(
    "input",
    {
      ...rest,
      ref: element,
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
