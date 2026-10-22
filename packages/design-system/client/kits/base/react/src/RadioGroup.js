"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Fieldset } from "./Fieldset.js";
import { Label } from "./Label.js";
import { radioGroup } from "../../src/radio-group.variants.js";
import { afterFormReset } from "../../src/core/native-controls.js";
function RadioGroup({ legend, name, options, variant = "list", optionMedia, value, defaultValue, onValueChange, required = false, help, error, id, className, optionClass, controlClass, ref, ...rest }) {
  const generated = useId();
  const prefix = id ?? `${generated}-option`;
  const [local, setLocal] = useState(defaultValue);
  const initial = useRef(defaultValue);
  const supplied = useRef(value);
  supplied.current = value;
  const element = useRef(null);
  useImperativeHandle(ref, () => element.current, []);
  const current = value ?? local;
  const styles = radioGroup({ variant });
  useEffect(() => afterFormReset(element.current?.form, () => {
    const next = supplied.current ?? initial.current;
    if (supplied.current === void 0) setLocal(next);
    element.current?.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.checked = input.value === next;
    });
  }), [rest.form]);
  return /* @__PURE__ */ jsx(Fieldset, { ...rest, ref: element, legend, help, error, className: styles.root({ class: className }), children: (control) => /* @__PURE__ */ jsx("div", { className: styles.list(), "data-radio-list": true, "data-variant": variant, children: options.map((option, index) => {
    const optionId = `${prefix}-${index}`;
    return /* @__PURE__ */ jsxs(Label, { className: styles.option({ class: optionClass }), htmlFor: optionId, children: [
      /* @__PURE__ */ jsxs("span", { className: styles.choice(), "data-choice-control": true, children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            ...control,
            "aria-labelledby": `${optionId}-label`,
            "aria-describedby": [control["aria-describedby"], option.description ? `${optionId}-description` : void 0].filter(Boolean).join(" ") || void 0,
            id: optionId,
            type: "radio",
            name,
            value: option.value,
            checked: current === option.value,
            onChange: (event) => {
              const next = event.currentTarget.value;
              if (value === void 0) setLocal(next);
              onValueChange?.(next);
            },
            required,
            disabled: option.disabled,
            form: rest.form,
            className: styles.control({ class: controlClass })
          }
        ),
        /* @__PURE__ */ jsx("span", { className: styles.box(), "aria-hidden": "true", "data-choice-box": true }),
        /* @__PURE__ */ jsx("span", { className: styles.dot(), "aria-hidden": "true", "data-choice-mark": true })
      ] }),
      /* @__PURE__ */ jsxs("span", { className: styles.content(), children: [
        optionMedia?.(option),
        /* @__PURE__ */ jsx("span", { id: `${optionId}-label`, className: styles.label(), children: option.label }),
        option.description && /* @__PURE__ */ jsx("span", { id: `${optionId}-description`, className: styles.description(), children: option.description })
      ] })
    ] }, option.value);
  }) }) });
}
export {
  RadioGroup
};
