import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Menu } from "@base-ui/react/menu";
import { Icon, dropdownMenuGroups, dropdownMenuItems } from "@reddb-io/design-system/base";
function MenuRows({ items, size, slots }) {
  const groups = dropdownMenuGroups(items), hasIcons = dropdownMenuItems(items).some((item) => item.icon !== void 0);
  return /* @__PURE__ */ jsx(Fragment, { children: groups.map((group, index) => /* @__PURE__ */ jsxs("div", { children: [
    index > 0 && /* @__PURE__ */ jsx(Menu.Separator, { className: slots.separator() }),
    /* @__PURE__ */ jsxs(Menu.Group, { className: slots.group(), children: [
      group.heading !== void 0 && /* @__PURE__ */ jsx(Menu.GroupLabel, { className: slots.heading(), children: group.heading }),
      group.items.map((item) => /* @__PURE__ */ jsxs(Menu.Item, { label: item.label, disabled: item.disabled, onClick: () => item.onselect?.(), className: slots.item(), render: item.href !== void 0 ? /* @__PURE__ */ jsx("a", { href: item.href }) : void 0, children: [
        hasIcons && /* @__PURE__ */ jsx("span", { "data-menu-item-icon": true, "aria-hidden": "true", className: slots.icon(), children: item.icon && /* @__PURE__ */ jsx(Icon, { icon: item.icon, size, "aria-hidden": "true" }) }),
        item.label
      ] }, item.id))
    ] })
  ] }, index)) });
}
export {
  MenuRows
};
