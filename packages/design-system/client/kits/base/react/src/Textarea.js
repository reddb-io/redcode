"use client";
import { jsx } from "react/jsx-runtime";
import { textarea } from "../../src/textarea.variants.js";
import { useAccessibleControl } from "./use-accessible-control.js";
function Textarea({ className, onChange, onValueChange, ref, ...rest }) {
  const element = useAccessibleControl("Textarea", ref);
  return /* @__PURE__ */ jsx(
    "textarea",
    {
      ...rest,
      ref: element,
      className: textarea({ class: className }),
      onChange: (event) => {
        onChange?.(event);
        onValueChange?.(event.currentTarget.value);
      }
    }
  );
}
export {
  Textarea
};
