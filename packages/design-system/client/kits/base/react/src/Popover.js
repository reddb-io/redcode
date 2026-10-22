"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useCallback, useRef } from "react";
import { Popover as Managed } from "@base-ui/react/popover";
import { trapScopeTab } from "../../src/core/focus-scope.js";
import { Button } from "./Button.js";
import { popover } from "../../src/popover.variants.js";
import { usePortalAppearance, useValue } from "./state.js";
function Popover(props) {
  const { triggerLabel, contentLabel, open = false, disabled = false, variant = "secondary", size = "md", side = "bottom", align = "start", sideOffset = 8, collisionPadding = 8, trigger, children, className, triggerClass, onOpenChange } = props;
  const [active, setActive] = useValue(props.open, open, onOpenChange), anchor = useRef(null), portal = usePortalAppearance(anchor, active);
  const bindSurface = useCallback((node) => node ? trapScopeTab(node) : void 0, []);
  return /* @__PURE__ */ jsxs(Managed.Root, { open: active, onOpenChange: setActive, modal: "trap-focus", children: [
    /* @__PURE__ */ jsx(Managed.Trigger, { ref: anchor, render: /* @__PURE__ */ jsx(Button, { variant, size, disabled, className: triggerClass }), "data-popover-trigger": true, "aria-label": triggerLabel, children: trigger ?? triggerLabel }),
    /* @__PURE__ */ jsx(Managed.Portal, { container: portal.container, children: /* @__PURE__ */ jsx(Managed.Positioner, { ...portal.attributes, side, align, sideOffset, collisionPadding, children: /* @__PURE__ */ jsx(Managed.Popup, { ref: bindSurface, "data-popover-surface": true, "data-ds-focus-scope": true, "data-avoid-collisions": "true", "data-collision-padding": collisionPadding, "aria-label": contentLabel, className: popover({ class: className }), children }) }) })
  ] });
}
export {
  Popover
};
