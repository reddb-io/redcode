"use client";
import { jsx } from "react/jsx-runtime";
import { useBinaryChoice } from "./use-binary-choice.js";
import { Field } from "./Field.js";
import { switchControl } from "../../src/switch.variants.js";
function Switch({ label, help, error, required = false, id, checked, defaultChecked, ref, className, fieldClass, onChange, onCheckedChange, ...rest }) {
  const controlState = useBinaryChoice(checked, defaultChecked, ref, rest.form);
  return /* @__PURE__ */ jsx(Field, { label, help, error, required, id, layout: "inline", className: fieldClass, children: (control) => /* @__PURE__ */ jsx(
    "input",
    {
      ...rest,
      ...control,
      ref: controlState.element,
      checked: controlState.current,
      type: "checkbox",
      role: "switch",
      className: switchControl({ class: className }),
      onChange: (event) => {
        const next = event.currentTarget.checked;
        controlState.update(next);
        onChange?.(event);
        onCheckedChange?.(next);
      }
    }
  ) });
}
export {
  Switch
};
