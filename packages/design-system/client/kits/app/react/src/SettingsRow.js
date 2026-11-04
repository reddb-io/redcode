"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { Label } from "@reddb-io/design-system/base";
import { settingsRowAssociation } from "../../src/core/settings-row.js";
import { settingsRow } from "../../src/composites/settings-row.variants.js";
function SettingsRow({ label, hint, wide = false, description, error, required = false, id, children, actions, className }) {
  const generated = useId();
  const association = settingsRowAssociation({ label, description, error, required, id: id ?? `${generated}-control` });
  const styles = settingsRow();
  return /* @__PURE__ */ jsxs("div", { "data-settings-row": true, className: styles.root({ class: className }), role: "group", "aria-labelledby": association.labelId, children: [
    /* @__PURE__ */ jsxs("div", { className: styles.row(), children: [
      /* @__PURE__ */ jsxs("div", { className: styles.copy({ class: wide && !children ? "@sm/settings-row:col-span-2" : void 0 }), children: [
        children ? /* @__PURE__ */ jsxs(Label, { id: association.labelId, htmlFor: association.control.id, className: styles.label(), children: [
          /* @__PURE__ */ jsxs("span", { className: styles.heading(), children: [
            /* @__PURE__ */ jsx("span", { children: label }),
            hint && /* @__PURE__ */ jsx("span", { className: styles.hint(), children: hint })
          ] }),
          required && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("span", { className: styles.required(), "aria-hidden": "true", children: "*" }),
            /* @__PURE__ */ jsx("span", { className: "sr-only", children: " (required)" })
          ] })
        ] }) : /* @__PURE__ */ jsx("p", { id: association.labelId, className: styles.label(), children: /* @__PURE__ */ jsxs("span", { className: styles.heading(), children: [
          /* @__PURE__ */ jsx("span", { children: label }),
          hint && /* @__PURE__ */ jsx("span", { className: styles.hint(), children: hint })
        ] }) }),
        description && /* @__PURE__ */ jsx("p", { id: association.helpId, className: styles.description(), children: description }),
        error && /* @__PURE__ */ jsx("p", { id: association.errorId, className: styles.error(), role: "alert", children: error })
      ] }),
      (children || actions != null && !wide) && /* @__PURE__ */ jsxs("div", { className: styles.end(), children: [
        children && /* @__PURE__ */ jsx("div", { "data-settings-row-control": true, className: styles.control(), children: children(association.control) }),
        actions != null && !wide && /* @__PURE__ */ jsx("div", { "data-settings-row-actions": true, className: styles.actions(), children: actions })
      ] })
    ] }),
    actions != null && wide && /* @__PURE__ */ jsx("div", { "data-settings-row-actions": true, "data-wide": "", className: styles.wideActions(), children: actions })
  ] });
}
export {
  SettingsRow
};
