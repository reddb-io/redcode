"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { Label } from "@reddb-io/design-system/base";
import { settingsRowAssociation } from "../../src/core/settings-row.js";
import { settingsRow } from "../../src/composites/settings-row.variants.js";
function SettingsRow({ label, description, error, required = false, id, children, actions, className }) {
  const generated = useId();
  const association = settingsRowAssociation({ label, description, error, required, id: id ?? `${generated}-control` });
  const styles = settingsRow();
  return /* @__PURE__ */ jsx("div", { "data-settings-row": true, className: styles.root({ class: className }), role: "group", "aria-labelledby": association.labelId, children: /* @__PURE__ */ jsxs("div", { className: styles.row(), children: [
    /* @__PURE__ */ jsxs("div", { className: styles.copy(), children: [
      children ? /* @__PURE__ */ jsxs(Label, { id: association.labelId, htmlFor: association.control.id, className: styles.label(), children: [
        label,
        required && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("span", { className: styles.required(), "aria-hidden": "true", children: "*" }),
          /* @__PURE__ */ jsx("span", { className: "sr-only", children: " (required)" })
        ] })
      ] }) : /* @__PURE__ */ jsx("p", { id: association.labelId, className: styles.label(), children: label }),
      description && /* @__PURE__ */ jsx("p", { id: association.helpId, className: styles.description(), children: description }),
      error && /* @__PURE__ */ jsx("p", { id: association.errorId, className: styles.error(), role: "alert", children: error })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: styles.end(), children: [
      children && /* @__PURE__ */ jsx("div", { "data-settings-row-control": true, className: styles.control(), children: children(association.control) }),
      actions != null && /* @__PURE__ */ jsx("div", { "data-settings-row-actions": true, className: styles.actions(), children: actions })
    ] })
  ] }) });
}
export {
  SettingsRow
};
