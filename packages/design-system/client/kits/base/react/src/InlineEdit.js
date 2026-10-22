"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button.js";
import { Input } from "./Input.js";
import { Icon } from "./Icon.js";
import { inlineEdit } from "../../src/inline-edit.variants.js";
import { createInlineEditSession, inlineEditReadValue } from "../../src/core/inline-edit.js";
function InlineEdit({ label, icon, presentation = "text", editVisibility = "always", sourceLabel, savedLabel = "Saved", inputType = "text", value, editing, defaultEditing = false, onValueChange, onEditingChange, validate, onConfirm, disabled = false, required = true, maxLength, emptyLabel = "Untitled", editLabel = "Edit", saveLabel = "Save", cancelLabel = "Cancel", requiredMessage = "Enter a value.", saveErrorMessage = "Could not save. Try again.", className, ref }) {
  const id = useId(), styles = inlineEdit({ editVisibility, presentation, withIcon: Boolean(icon) });
  const [localEditing, setLocalEditing] = useState(defaultEditing);
  const active = editing ?? localEditing;
  const [state, setState] = useState(() => ({ draft: value, error: "", saving: false }));
  const sessionRef = useRef(null);
  const session = sessionRef.current ??= createInlineEditSession(value, setState);
  const input = useRef(null), readRow = useRef(null);
  const previous = useRef({ active: false, value }), restoreFocus = useRef(false);
  useEffect(() => {
    const was = previous.current;
    if (value !== was.value || active !== was.active) session.reset(value);
    if (active && (!was.active || value !== was.value)) {
      input.current?.focus();
      input.current?.select();
    }
    if (!active && restoreFocus.current) {
      readRow.current?.querySelector("button")?.focus();
      restoreFocus.current = false;
    }
    previous.current = { active, value };
  }, [active, value, session]);
  useEffect(() => () => session.invalidate(), [session]);
  useEffect(() => {
    if (active && state.error && !state.saving) input.current?.focus();
  }, [active, state.error, state.saving]);
  function requestEditing(next) {
    if (!next) restoreFocus.current = true;
    if (editing === void 0) setLocalEditing(next);
    onEditingChange?.(next);
  }
  async function save() {
    if (disabled) return;
    const result = await session.save({ required, requiredMessage, saveErrorMessage, validate, confirm: onConfirm });
    if (result.status === "committed") {
      onValueChange?.(result.value);
      requestEditing(false);
    }
  }
  function cancel() {
    if (!session.state.saving) {
      session.reset(value);
      requestEditing(false);
    }
  }
  return /* @__PURE__ */ jsxs("div", { ref, role: "group", "aria-labelledby": `${id}-label`, "aria-describedby": presentation === "input" && !active ? `${id}-status` : void 0, className: styles.root({ class: className }), "data-inline-edit": true, "data-presentation": presentation, "data-state": active ? state.saving ? "saving" : "editing" : "saved", children: [
    /* @__PURE__ */ jsx("span", { id: `${id}-label`, className: styles.label(), children: label }),
    active ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("form", { className: styles.row(), "aria-labelledby": `${id}-label`, "aria-busy": state.saving, onSubmit: (event) => {
        event.preventDefault();
        void save();
      }, noValidate: true, children: [
        /* @__PURE__ */ jsxs("div", { className: styles.field(), children: [
          icon && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.inputIcon(), children: /* @__PURE__ */ jsx(Icon, { icon, size: "sm", color: "current", focusable: "false" }) }),
          /* @__PURE__ */ jsx(
            Input,
            {
              ref: input,
              type: inputType,
              controlSize: presentation === "input" ? "md" : "sm",
              value: state.draft,
              onValueChange: (next) => session.change(next),
              "aria-labelledby": `${id}-label`,
              "aria-invalid": state.error ? "true" : void 0,
              "aria-describedby": state.error ? `${id}-error` : void 0,
              maxLength,
              required,
              disabled: disabled || state.saving,
              className: styles.input(),
              onKeyDown: (event) => {
                if (event.key === "Escape" && !event.nativeEvent.isComposing && !session.state.saving) {
                  event.preventDefault();
                  event.stopPropagation();
                  cancel();
                }
                if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
              }
            }
          )
        ] }),
        /* @__PURE__ */ jsx(Button, { type: "submit", size: presentation === "input" ? "md" : "sm", disabled: disabled || state.saving, loading: state.saving, children: saveLabel }),
        /* @__PURE__ */ jsx(Button, { variant: "ghost", size: presentation === "input" ? "md" : "sm", disabled: state.saving, onClick: cancel, children: cancelLabel })
      ] }),
      state.error && /* @__PURE__ */ jsx("p", { id: `${id}-error`, role: "alert", className: styles.error(), children: state.error })
    ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("div", { ref: readRow, className: styles.row(), children: [
        /* @__PURE__ */ jsxs("span", { "data-inline-edit-value": true, className: styles.value(), children: [
          icon && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.icon(), children: /* @__PURE__ */ jsx(Icon, { icon, size: "sm", color: "current", focusable: "false" }) }),
          /* @__PURE__ */ jsx("span", { className: styles.readText(), children: inlineEditReadValue(value, inputType, emptyLabel) })
        ] }),
        /* @__PURE__ */ jsx(Button, { size: presentation === "input" ? "md" : "sm", variant: "ghost", className: styles.edit(), disabled, "aria-label": `${editLabel} ${label}`, onClick: () => requestEditing(true), children: editLabel })
      ] }),
      presentation === "input" && /* @__PURE__ */ jsxs("p", { id: `${id}-status`, "data-saved-value": true, role: "status", className: styles.status(), children: [
        savedLabel,
        sourceLabel ? ` \xB7 ${sourceLabel}` : ""
      ] })
    ] })
  ] });
}
export {
  InlineEdit
};
