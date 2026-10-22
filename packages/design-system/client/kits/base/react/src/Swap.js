"use client";
import { jsx } from "react/jsx-runtime";
import { useState } from "react";
import { ToggleButton } from "./ToggleButton.js";
import { swap, swapFace } from "../../src/swap.variants.js";
function Swap({ label, swapped, defaultSwapped = false, off, on, disabled = false, className, onClick, onSwappedChange, ...rest }) {
  const [local, setLocal] = useState(defaultSwapped);
  const current = swapped ?? local;
  return /* @__PURE__ */ jsx(
    ToggleButton,
    {
      ...rest,
      label,
      pressed: current,
      disabled,
      "data-swap": true,
      className: swap({ class: className }),
      onPressedChange: (next) => {
        if (swapped === void 0) setLocal(next);
      },
      onClick: (event) => {
        onClick?.(event);
        onSwappedChange?.(!current);
      },
      children: /* @__PURE__ */ jsx("span", { className: swapFace(), children: current ? on ?? label : off ?? label })
    }
  );
}
export {
  Swap
};
