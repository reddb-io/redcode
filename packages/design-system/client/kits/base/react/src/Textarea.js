"use client";
import { jsx } from "react/jsx-runtime";
import { textarea } from "../../src/textarea.variants.js";
function Textarea({ className, onChange, onValueChange, ...rest }) {
  return /* @__PURE__ */ jsx(
    "textarea",
    {
      ...rest,
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
