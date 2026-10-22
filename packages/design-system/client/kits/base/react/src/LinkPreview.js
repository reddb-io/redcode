"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { PreviewCard as Managed } from "@base-ui/react/preview-card";
import { link } from "../../src/link.variants.js";
import { linkPreview } from "../../src/link-preview.variants.js";
import { usePortalAppearance, useValue } from "./state.js";
function LinkPreview(props) {
  const { href, label, previewLabel, open = false, onOpenChange, openDelay = 700, closeDelay = 300, side = "top", align = "center", sideOffset = 8, collisionPadding = 8, trigger, children, className, triggerClass, ...rest } = props;
  const [active, setActive] = useValue(props.open, open, onOpenChange), anchor = useRef(null), portal = usePortalAppearance(anchor, active);
  return /* @__PURE__ */ jsxs(Managed.Root, { open: active, onOpenChange: setActive, children: [
    /* @__PURE__ */ jsx(Managed.Trigger, { ...rest, ref: anchor, href, delay: openDelay, closeDelay, "data-link-preview-trigger": true, role: "link", className: link({ class: triggerClass }), children: trigger ?? label }),
    /* @__PURE__ */ jsx(Managed.Portal, { container: portal.container, children: /* @__PURE__ */ jsx(Managed.Positioner, { ...portal.attributes, side, align, sideOffset, collisionPadding, children: /* @__PURE__ */ jsx(Managed.Popup, { "data-link-preview-surface": true, "data-avoid-collisions": "true", "data-collision-padding": collisionPadding, role: "dialog", "aria-label": previewLabel, className: linkPreview({ class: className }), children }) }) })
  ] });
}
export {
  LinkPreview
};
