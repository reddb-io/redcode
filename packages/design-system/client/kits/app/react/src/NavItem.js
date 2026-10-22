import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { quietControl } from "@reddb-io/design-system/base";
import { navItem } from "../../src/primitives/nav-item.variants.js";
function NavItem({ label, href, current = false, disabled = false, icon, trailing, children, className, ...rest }) {
  const isCurrent = current !== false, styles = navItem({ current: isCurrent, disabled });
  const common = { "data-nav-item": "", "aria-current": isCurrent ? typeof current === "string" ? current : "page" : void 0, "aria-disabled": disabled || void 0 };
  const content = /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("span", { className: styles.label(), children: children ?? label }),
    " ",
    icon != null && icon !== false && /* @__PURE__ */ jsx("span", { className: styles.icon(), "aria-hidden": "true", children: icon }),
    " ",
    trailing != null && trailing !== false && /* @__PURE__ */ jsx("span", { className: styles.trailing(), children: trailing })
  ] });
  return href !== void 0 ? /* @__PURE__ */ jsx("a", { ...rest, ...common, className: quietControl({ selected: isCurrent, class: styles.root({ class: className }) }), href: disabled ? void 0 : href, onClick: disabled ? void 0 : rest.onClick, tabIndex: disabled ? -1 : rest.tabIndex, children: content }) : /* @__PURE__ */ jsx("button", { ...rest, ...common, className: quietControl({ selected: isCurrent, class: styles.root({ class: className }) }), type: "button", disabled, children: content });
}
export {
  NavItem
};
