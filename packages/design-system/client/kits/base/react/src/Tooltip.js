"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId, useRef, useState } from "react";
import { Tooltip as Managed } from "@base-ui/react/tooltip";
import { button } from "../../src/button.variants.js";
import { tooltip } from "../../src/tooltip.variants.js";
import { usePortalAppearance } from "./state.js";
function Tooltip({ label, content, children, child, className, disabled, ...rest }) {
  const id = useId(), anchor = useRef(null), [open, setOpen] = useState(false), portal = usePortalAppearance(anchor, open);
  return /* @__PURE__ */ jsx("span", { "data-tooltip-root": true, className: "relative inline-flex", children: /* @__PURE__ */ jsx(Managed.Provider, { delay: 0, children: /* @__PURE__ */ jsxs(Managed.Root, { open, onOpenChange: setOpen, disabled: Boolean(disabled), children: [
    /* @__PURE__ */ jsx(
      Managed.Trigger,
      {
        ...rest,
        "aria-label": label,
        "aria-describedby": open ? `${id}-description` : void 0,
        ref: anchor,
        delay: 0,
        disabled: Boolean(disabled),
        "data-tooltip-trigger": true,
        render: child ? (props) => child({ props: { ...props } }) : /* @__PURE__ */ jsx("button", { type: "button", disabled, "aria-label": label, className: button({ variant: "ghost", size: "sm", class: className }) }),
        children: children ?? label
      }
    ),
    /* @__PURE__ */ jsx(Managed.Portal, { container: portal.container, children: /* @__PURE__ */ jsx(Managed.Positioner, { ...portal.attributes, side: "top", align: "center", sideOffset: 8, collisionPadding: 8, children: /* @__PURE__ */ jsx(Managed.Popup, { id: `${id}-description`, role: "tooltip", "data-tooltip-surface": true, className: tooltip(), children: content }) }) })
  ] }) }) });
}
export {
  Tooltip
};
