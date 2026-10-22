"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { Menu as Managed } from "@base-ui/react/menu";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";
import { Kbd } from "./Kbd.js";
import { dropdownMenuGroups, dropdownMenuItems } from "../../src/core/dropdown-menu.js";
import { dropdownMenu } from "../../src/dropdown-menu.variants.js";
import { popover } from "../../src/popover.variants.js";
import { usePortalAppearance, useValue } from "./state.js";
function DropdownMenu(props) {
  const { triggerLabel, contentLabel, items = [], open = false, onOpenChange, variant = "secondary", size = "md", side = "bottom", align = "start", sideOffset = 8, collisionPadding = 8, trigger, className } = props;
  const [active, setActive] = useValue(props.open, open, onOpenChange), anchor = useRef(null), portal = usePortalAppearance(anchor, active);
  const groups = dropdownMenuGroups(items), hasIcons = dropdownMenuItems(items).some((item) => item.icon !== void 0), slots = dropdownMenu({ size });
  const row = (item) => /* @__PURE__ */ jsxs(Fragment, { children: [
    hasIcons && /* @__PURE__ */ jsx("span", { "data-menu-item-icon": true, "aria-hidden": "true", className: slots.icon(), children: item.icon && /* @__PURE__ */ jsx(Icon, { icon: item.icon, size, "aria-hidden": "true" }) }),
    /* @__PURE__ */ jsx("span", { className: slots.label(), children: item.label }),
    item.shortcut !== void 0 && /* @__PURE__ */ jsx("span", { className: slots.shortcut(), children: /* @__PURE__ */ jsx(Kbd, { keys: item.shortcut, size: "sm" }) })
  ] });
  return /* @__PURE__ */ jsxs(Managed.Root, { open: active, onOpenChange: setActive, loopFocus: true, children: [
    /* @__PURE__ */ jsx(Managed.Trigger, { ref: anchor, render: /* @__PURE__ */ jsx(Button, { variant, size }), "data-dropdown-menu-trigger": true, "aria-label": triggerLabel, children: trigger ?? triggerLabel }),
    /* @__PURE__ */ jsx(Managed.Portal, { container: portal.container, children: /* @__PURE__ */ jsx(Managed.Positioner, { ...portal.attributes, side, align, sideOffset, collisionPadding, children: /* @__PURE__ */ jsx(Managed.Popup, { "data-dropdown-menu-surface": true, "data-collision-padding": collisionPadding, "aria-label": contentLabel, className: popover({ class: slots.content({ class: className }) }), children: groups.map((group, index) => /* @__PURE__ */ jsxs("div", { children: [
      index > 0 && /* @__PURE__ */ jsx(Managed.Separator, { className: slots.separator(), "data-dropdown-menu-separator": true }),
      /* @__PURE__ */ jsxs(Managed.Group, { className: slots.group(), children: [
        group.heading !== void 0 && /* @__PURE__ */ jsx(Managed.GroupLabel, { className: slots.heading(), "data-dropdown-menu-group-heading": true, children: group.heading }),
        group.items.map((item) => /* @__PURE__ */ jsx(Managed.Item, { disabled: item.disabled, label: item.label, onClick: () => item.onselect?.(), className: slots.item(), render: item.href !== void 0 ? /* @__PURE__ */ jsx("a", { href: item.href }) : void 0, children: row(item) }, item.id))
      ] })
    ] }, index)) }) }) })
  ] });
}
export {
  DropdownMenu
};
