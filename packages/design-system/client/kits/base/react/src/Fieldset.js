"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { fieldset } from "../../src/fieldset.variants.js";
import { fieldsetAssociation } from "../../src/core/fieldset.js";
function Fieldset({ legend, help, error, legendClass, children, id, className, ...rest }) {
  const generated = useId();
  const baseId = id ?? `${generated}-group`;
  const { control, helpId, errorId } = fieldsetAssociation({ id: baseId, help, error });
  const slots = fieldset();
  return /* @__PURE__ */ jsxs("fieldset", { ...rest, id, className: slots.root({ class: className }), "data-fieldset-invalid": error ? "true" : void 0, children: [
    /* @__PURE__ */ jsx("legend", { className: slots.legend({ class: legendClass }), children: legend }),
    children?.(control),
    help && /* @__PURE__ */ jsx("p", { className: slots.help(), id: helpId, children: help }),
    error && /* @__PURE__ */ jsx("p", { className: slots.error(), id: errorId, role: "alert", children: error })
  ] });
}
export {
  Fieldset
};
