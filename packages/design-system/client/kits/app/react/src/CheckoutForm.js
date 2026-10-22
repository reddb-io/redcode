"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef } from "react";
import { Button, Field, Fieldset, Form, Input } from "@reddb-io/design-system/base";
import { checkoutForm } from "../../src/composites/checkout-form.appearance.js";
function CheckoutInput({ value, ...props }) {
  const input = useRef(null), initial = useRef(value ?? ""), previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (input.current) input.current.value = String(value ?? "");
  }, [value]);
  return /* @__PURE__ */ jsx(Input, { ...props, ref: input, defaultValue: initial.current });
}
function CheckoutForm({ sections = [], children, error, submitLabel, actions, className, sectionClass, actionsClass, ...rest }) {
  const id = useId(), styles = checkoutForm(), describedBy = [rest["aria-describedby"], error ? `${id}-error` : void 0].filter(Boolean).join(" ") || void 0;
  return /* @__PURE__ */ jsxs(Form, { ...rest, "data-checkout-form": true, "aria-describedby": describedBy, className: styles.root({ class: className }), children: [
    error && /* @__PURE__ */ jsx("p", { id: `${id}-error`, role: "alert", "data-checkout-error": true, className: styles.error(), children: error }),
    children,
    sections.map((section, sectionIndex) => /* @__PURE__ */ jsx(Fieldset, { legend: section.legend, disabled: section.disabled, className: styles.section({ class: sectionClass }), children: () => section.fields.map((field, fieldIndex) => /* @__PURE__ */ jsx(Field, { label: field.label, help: field.help, error: field.error, required: field.required, id: `${id}-${sectionIndex}-${fieldIndex}`, children: (control) => /* @__PURE__ */ jsx(CheckoutInput, { ...control, name: field.name, type: field.type ?? "text", value: field.value, autoComplete: field.autocomplete, inputMode: field.inputmode, placeholder: field.placeholder, disabled: field.disabled }) }, `${field.name}-${fieldIndex}`)) }, `${section.legend}-${sectionIndex}`)),
    (actions || submitLabel) && /* @__PURE__ */ jsx("div", { "data-checkout-actions": true, className: styles.actions({ class: actionsClass }), children: actions ?? /* @__PURE__ */ jsx(Button, { type: "submit", variant: "primary", children: submitLabel }) })
  ] });
}
export {
  CheckoutForm
};
