"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId, useRef } from "react";
import { ContextMenu as Managed } from "@base-ui/react/context-menu";
import { Button, useControllableValue, usePortalAppearance } from "@reddb-io/design-system/base";
import { contextMenu } from "../../src/composites/context-menu.variants.js";
import { MenuRows } from "./MenuRows.js";
function ContextMenu(props) {
  const { triggerLabel, contentLabel, items = [], open = false, onOpenChange, disabled = false, size = "md", collisionPadding = 8, children, className, targetClass } = props;
  const [active, setActive] = useControllableValue(props.open, open, onOpenChange), id = useId(), root = useRef(null), portal = usePortalAppearance(root, active), styles = contextMenu({ size });
  return /* @__PURE__ */ jsxs(Managed.Root, { open: active, onOpenChange: setActive, disabled, children: [
    /* @__PURE__ */ jsx(Managed.Trigger, { ref: root, "data-context-menu-trigger": true, "aria-label": triggerLabel, "aria-haspopup": "menu", "aria-expanded": active, "aria-controls": `${id}-menu`, render: /* @__PURE__ */ jsx(Button, { variant: "secondary", size, disabled, className: targetClass }), onKeyDown: (event) => {
      if (disabled || !(event.key === "ContextMenu" || event.key === "F10" && event.shiftKey)) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom }));
    }, children: children ?? triggerLabel }),
    /* @__PURE__ */ jsx(Managed.Portal, { container: portal.container, children: /* @__PURE__ */ jsx(Managed.Positioner, { ...portal.attributes, collisionPadding, children: /* @__PURE__ */ jsx(Managed.Popup, { id: `${id}-menu`, "data-context-menu-surface": true, "aria-label": contentLabel, className: styles.content({ class: className }), children: /* @__PURE__ */ jsx(MenuRows, { items, size, slots: styles }) }) }) })
  ] });
}
export {
  ContextMenu
};
