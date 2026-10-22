import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Badge, Icon, Indicator, StatusIndicator } from "@reddb-io/design-system/base";
import { NavItem } from "./NavItem.js";
import { navigationBadge, navigationItems, navigationMarkerLabel } from "../../src/composites/navigation.behavior.js";
import { sidebarNavigation } from "../../src/composites/sidebar-navigation.variants.js";
function SidebarNavigation({ label, items, currentId, toolbar, toolbarLabel = "Sidebar actions", className, ...rest }) {
  const resolved = navigationItems(items, currentId), styles = sidebarNavigation();
  return /* @__PURE__ */ jsxs("nav", { ...rest, "aria-label": label, "data-sidebar-navigation": true, className: styles.root({ class: className }), children: [
    toolbar != null && toolbar !== false && /* @__PURE__ */ jsx("div", { role: "group", "aria-label": toolbarLabel, "data-sidebar-toolbar": true, className: styles.toolbar(), children: toolbar }),
    /* @__PURE__ */ jsx("ul", { className: styles.list(), children: resolved.map((item) => {
      const icon = item.icon && /* @__PURE__ */ jsx(Icon, { icon: item.icon, size: "sm", color: item.current ? "foreground" : "ink-muted", "aria-hidden": "true" });
      const glyph = icon && (item.status ? /* @__PURE__ */ jsx(Indicator, { position: "bottom-end", marker: /* @__PURE__ */ jsx(StatusIndicator, { label: item.status.label, tone: item.status.tone, showLabel: false }), children: icon }) : icon);
      const markers = /* @__PURE__ */ jsxs(Fragment, { children: [
        item.status && !item.icon && /* @__PURE__ */ jsx(StatusIndicator, { label: item.status.label, tone: item.status.tone, showLabel: false, "aria-hidden": "true" }),
        item.badge !== void 0 && /* @__PURE__ */ jsx(Badge, { tone: item.badgeTone ?? "neutral", variant: "filled", "aria-hidden": "true", children: navigationBadge(item.badge) })
      ] });
      return /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsx(NavItem, { label: item.label, "aria-label": navigationMarkerLabel(item, item.label), href: item.href, current: item.current, disabled: item.disabled, "data-navigation-item": item.id, className: styles.item(), onClick: item.onselect, icon: glyph, trailing: item.badge !== void 0 || item.status && !item.icon ? markers : void 0 }) }, item.id);
    }) })
  ] });
}
export {
  SidebarNavigation
};
