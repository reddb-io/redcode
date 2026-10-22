"use client";
import { jsx } from "react/jsx-runtime";
import { useState } from "react";
import { Button } from "./Button.js";
import { toggleButton } from "../../src/toggle-button.variants.js";
import { nextPressed } from "../../src/core/native-controls.js";
function ToggleButton({ label, pressed, defaultPressed = false, allowUnpress = true, disabled = false, children, className, onClick, onPressedChange, ...rest }) {
  const [local, setLocal] = useState(defaultPressed);
  const current = pressed ?? local;
  return /* @__PURE__ */ jsx(
    Button,
    {
      ...rest,
      disabled,
      variant: "secondary",
      type: "button",
      className: toggleButton({ pressed: current, class: className }),
      "aria-pressed": current,
      "aria-label": children != null ? label : void 0,
      "data-state": current ? "on" : "off",
      "data-toggle-button": true,
      onClick: (event) => {
        if (disabled) return;
        const next = nextPressed(current, allowUnpress);
        if (next !== current) {
          if (pressed === void 0) setLocal(next);
          onPressedChange?.(next);
        }
        onClick?.(event);
      },
      children: children ?? label
    }
  );
}
export {
  ToggleButton
};
