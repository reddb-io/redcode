"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useBinaryChoice } from "./use-binary-choice.js";
import { Field } from "./Field.js";
import { checkbox } from "../../src/checkbox.variants.js";
function Checkbox({ label, help, error, required = false, id, checked, defaultChecked, ref, className, fieldClass, onChange, onCheckedChange, ...rest }) {
  const controlState = useBinaryChoice(checked, defaultChecked, ref, rest.form);
  const styles = checkbox();
  return /* @__PURE__ */ jsx(Field, { label, help, error, required, id, layout: "inline", className: fieldClass, children: (control) => /* @__PURE__ */ jsxs("span", { className: styles.root(), "data-choice-control": true, children: [
    /* @__PURE__ */ jsx(
      "input",
      {
        ...rest,
        ...control,
        ref: controlState.element,
        checked: controlState.current,
        type: "checkbox",
        className: styles.control({ class: className }),
        onChange: (event) => {
          const next = event.currentTarget.checked;
          controlState.update(next);
          onChange?.(event);
          onCheckedChange?.(next);
        }
      }
    ),
    /* @__PURE__ */ jsx("span", { className: styles.box(), "aria-hidden": "true", "data-choice-box": true }),
    /* @__PURE__ */ jsx("span", { className: styles.mark(), "aria-hidden": "true", "data-choice-mark": true })
  ] }) });
}
export {
  Checkbox
};
