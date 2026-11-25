"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, Select, Textarea } from "@reddb-io/design-system/base";
import { shouldSubmitPrompt } from "../../src/core/contracts/promptcomposer.js";
import { promptComposer } from "../../src/composites/prompt-composer.variants.js";
function PromptComposer({ label, value, defaultValue = "", placeholder, status = "idle", selectors = [], maxRows = 8, disabled = false, submitLabel = "Send", stopLabel = "Stop", onValueChange, onSendRequest, onStopRequest, onSelectorChange, className, ...rest }) {
  const [local, setLocal] = useState(defaultValue);
  const text = value ?? local;
  const styles = promptComposer();
  const empty = !text.trim();
  const submit = () => {
    if (disabled || status !== "idle" || empty) return;
    onSendRequest?.(text);
  };
  const keydown = (event) => {
    if (!shouldSubmitPrompt({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode })) return;
    event.preventDefault();
    submit();
  };
  return /* @__PURE__ */ jsxs("form", { ...rest, "data-prompt-composer": true, "data-status": status, className: styles.root({ class: className }), onSubmit: (event) => {
    event.preventDefault();
    submit();
  }, children: [
    /* @__PURE__ */ jsx(
      Textarea,
      {
        "aria-label": label,
        value: text,
        placeholder,
        disabled,
        rows: 1,
        style: { maxHeight: `calc(${maxRows}lh + 2 * var(--reddb-spatial-inset-sm))` },
        className: styles.field(),
        onKeyDown: keydown,
        onValueChange: (next) => {
          setLocal(next);
          onValueChange?.(next);
        }
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: styles.footer(), children: [
      selectors.length > 0 && /* @__PURE__ */ jsx("div", { className: styles.selectors(), "data-prompt-composer-selectors": true, children: selectors.map((selector) => /* @__PURE__ */ jsx(Select, { "aria-label": selector.label, value: selector.value, options: [...selector.options], disabled, onValueChange: (next) => onSelectorChange?.(selector.id, next) }, selector.id)) }),
      status === "streaming" ? /* @__PURE__ */ jsx(Button, { type: "button", variant: "secondary", className: styles.send(), onClick: () => onStopRequest?.(), children: stopLabel }) : /* @__PURE__ */ jsx(Button, { type: "submit", variant: "primary", className: styles.send(), disabled: disabled || status === "submitting" || empty, loading: status === "submitting", children: submitLabel })
    ] })
  ] });
}
export {
  PromptComposer
};
