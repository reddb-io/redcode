import { jsx } from "react/jsx-runtime";
import { Badge, Icon, Indicator, StatusIndicator } from "@reddb-io/design-system/base";
import { NavItem } from "./NavItem.js";
import { navigationBadge, navigationItems, navigationMarkerLabel } from "../../src/composites/navigation.behavior.js";
import { bottomNavigation } from "../../src/composites/bottom-navigation.variants.js";
function BottomNavigation({ label, items, currentId, className, ...rest }) {
  const resolved = navigationItems(items, currentId), styles = bottomNavigation();
  return /* @__PURE__ */ jsx("nav", { ...rest, "aria-label": label, "data-bottom-navigation": true, className: styles.root({ class: className }), children: /* @__PURE__ */ jsx("ul", { className: styles.list(), children: resolved.map((item) => {
    const face = item.icon ? /* @__PURE__ */ jsx(Icon, { icon: item.icon, size: "md", color: item.current ? "foreground" : "ink-muted", "aria-hidden": "true" }) : item.fallback ? /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: item.fallback }) : null;
    const glyph = /* @__PURE__ */ jsx("span", { className: styles.face(), children: /* @__PURE__ */ jsx(Indicator, { className: "size-full items-center justify-center", marker: item.badge !== void 0 && /* @__PURE__ */ jsx(Badge, { tone: item.badgeTone ?? "neutral", variant: "filled", className: styles.badge(), "aria-hidden": "true", children: navigationBadge(item.badge) }), children: /* @__PURE__ */ jsx(Indicator, { position: "bottom-end", className: "size-full items-center justify-center", marker: item.status && /* @__PURE__ */ jsx(StatusIndicator, { label: item.status.label, tone: item.status.tone, showLabel: false, "aria-hidden": "true" }), children: face }) }) });
    return /* @__PURE__ */ jsx("li", { className: styles.entry(), children: /* @__PURE__ */ jsx(NavItem, { label: item.label, "aria-label": navigationMarkerLabel(item, item.label), "aria-expanded": item.expanded, "aria-controls": item.controls, href: item.href, current: item.current, disabled: item.disabled, "data-navigation-item": item.id, className: styles.item(), onClick: item.onselect, icon: item.icon || item.fallback || item.badge !== void 0 || item.status ? glyph : void 0 }) }, item.id);
  }) }) });
}
export {
  BottomNavigation
};
