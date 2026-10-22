"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { Menubar as ManagedBar } from "@base-ui/react/menubar";
import { Menu as Managed } from "@base-ui/react/menu";
import { Button, useControllableValue, usePortalAppearance } from "@reddb-io/design-system/base";
import { menubar } from "../../src/composites/menubar.variants.js";
import { MenuRows } from "./MenuRows.js";
function Menubar(props) {
  const { label, menus = [], value = "", onValueChange, size = "md", loop = true, sideOffset = 8, collisionPadding = 8, className } = props;
  const [current, setCurrent] = useControllableValue(props.value, value, onValueChange), latest = useRef(current), root = useRef(null), portal = usePortalAppearance(root, !!current), styles = menubar({ size });
  latest.current = current;
  const choose = (next) => {
    latest.current = next;
    setCurrent(next);
  };
  return /* @__PURE__ */ jsx(ManagedBar, { ref: root, loopFocus: loop, "aria-label": label, "data-command-menubar": true, className: styles.root({ class: className }), children: menus.map((menu) => /* @__PURE__ */ jsxs(Managed.Root, { open: current === menu.id, onOpenChange: (open) => {
    if (open) choose(menu.id);
    else if (latest.current === menu.id) choose("");
  }, loopFocus: true, children: [
    /* @__PURE__ */ jsx(Managed.Trigger, { disabled: menu.disabled, render: /* @__PURE__ */ jsx(Button, { variant: "ghost", size }), "data-menubar-trigger": true, children: menu.label }),
    /* @__PURE__ */ jsx(Managed.Portal, { container: portal.container, children: /* @__PURE__ */ jsx(Managed.Positioner, { ...portal.attributes, sideOffset, collisionPadding, children: /* @__PURE__ */ jsx(Managed.Popup, { "data-menubar-surface": true, "aria-label": `${menu.label} commands`, className: styles.content(), children: /* @__PURE__ */ jsx(MenuRows, { items: menu.items, size, slots: styles }) }) }) })
  ] }, menu.id)) });
}
export {
  Menubar
};
