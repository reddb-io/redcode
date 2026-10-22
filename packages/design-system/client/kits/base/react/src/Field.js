"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { field } from "../../src/field.variants.js";
import { Label } from "./Label.js";
import { fieldAssociation } from "../../src/core/field.js";
function Field({ label, help, error, required = false, id, layout = "stacked", className, children }) {
  const generated = useId();
  const controlId = id ?? `${generated}-control`;
  const { control, helpId, errorId } = fieldAssociation({ id: controlId, help, error, required });
  const slots = field({ layout });
  const content = children(control);
  return /* @__PURE__ */ jsxs("div", { className: slots.root({ class: className }), "data-field-layout": layout, "data-field-invalid": error ? "true" : void 0, children: [
    layout === "inline" && content,
    /* @__PURE__ */ jsxs(Label, { className: slots.label(), htmlFor: controlId, children: [
      label,
      required && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("span", { className: slots.required(), "aria-hidden": "true", children: "*" }),
        /* @__PURE__ */ jsx("span", { className: "sr-only", children: " (required)" })
      ] })
    ] }),
    layout !== "inline" && content,
    help && /* @__PURE__ */ jsx("p", { id: helpId, className: slots.help(), children: help }),
    error && /* @__PURE__ */ jsx("p", { id: errorId, className: slots.error(), role: "alert", children: error })
  ] });
}
export {
  Field
};
