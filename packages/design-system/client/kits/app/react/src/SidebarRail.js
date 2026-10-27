"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Badge, Button, Divider, Icon, Indicator, StatusIndicator, Tooltip } from "@reddb-io/design-system/base";
import { sidebarRailSizing } from "../../src/core/sidebar-rail-sizing.js";
import { face, nameOf } from "../../src/core/sidebar-rail.js";
import { navigationBadge, navigationMarkerLabel } from "../../src/composites/navigation.behavior.js";
import { sidebarRail } from "../../src/composites/sidebar-rail.variants.js";
function SidebarRail({ label, items, currentId, onSelect, top, bottom, showLabels = false, itemSize, iconSize, itemGap, labelGap, railWidth, railPadding, labelSize, style, className, onKeyDown, onFocus, ...rest }) {
  const initial = () => {
    const current = items.findIndex((item) => item.id === currentId && !item.disabled);
    return current >= 0 ? current : Math.max(0, items.findIndex((item) => !item.disabled));
  };
  const [focusIndex, setFocusIndex] = useState(initial), styles = sidebarRail({ labelled: showLabels });
  useEffect(() => {
    if (!items[focusIndex] || items[focusIndex]?.disabled) setFocusIndex(initial());
  }, [items, focusIndex, currentId]);
  const sizing = sidebarRailSizing({ itemSize, iconSize, itemGap, labelGap, railWidth, railPadding, labelSize }, showLabels);
  return /* @__PURE__ */ jsxs("nav", { ...rest, style: { ...style, ...sizing.root }, "aria-label": label, "data-sidebar-rail": true, "data-sidebar-rail-labels": showLabels ? "" : void 0, className: styles.root({ class: className }), onKeyDown: (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !(event.target instanceof HTMLElement) || !event.target.dataset.sidebarRailItem) return;
    const available = [...event.currentTarget.querySelectorAll('[data-sidebar-rail-item]:not(:disabled):not([aria-disabled="true"])')], index = available.indexOf(event.target);
    if (index < 0) return;
    const next = event.key === "ArrowDown" ? (index + 1) % available.length : event.key === "ArrowUp" ? (index - 1 + available.length) % available.length : event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : void 0;
    if (next === void 0) return;
    event.preventDefault();
    const control = available[next];
    setFocusIndex(Number(control.dataset.sidebarRailIndex));
    control.focus();
  }, onFocus: (event) => {
    onFocus?.(event);
    if (event.target instanceof HTMLElement && event.target.dataset.sidebarRailItem) setFocusIndex(Number(event.target.dataset.sidebarRailIndex));
  }, children: [
    /* @__PURE__ */ jsx("div", { "data-sidebar-rail-region": "top", className: styles.region(), children: top }),
    /* @__PURE__ */ jsx("div", { "data-sidebar-rail-region": "middle", className: styles.region({ class: styles.middle() }), children: /* @__PURE__ */ jsx("ul", { "data-sidebar-rail-items": true, className: styles.list(), style: sizing.list, children: items.map((item, index) => {
      const glyph = item.icon ? /* @__PURE__ */ jsx(Icon, { icon: item.icon, size: "md", "aria-hidden": "true", "data-sidebar-rail-glyph": true, style: sizing.glyph }) : /* @__PURE__ */ jsx("span", { "aria-hidden": "true", "data-sidebar-rail-glyph": true, className: styles.fallback(), style: sizing.label, children: face(item) });
      return /* @__PURE__ */ jsxs("li", { className: "w-full", children: [
        item.separatorBefore && index > 0 && /* @__PURE__ */ jsx(Divider, { "data-sidebar-rail-divider": true, className: styles.divider() }),
        /* @__PURE__ */ jsx(Tooltip, { content: navigationMarkerLabel(item, item.label), disabled: item.disabled, child: ({ props }) => /* @__PURE__ */ jsxs(Button, { ...props, variant: "ghost", href: item.href, "aria-label": navigationMarkerLabel(item, nameOf(item, showLabels)), disabled: item.disabled, tabIndex: !item.disabled && index === focusIndex ? 0 : -1, "aria-pressed": item.href ? void 0 : item.id === currentId, "aria-current": item.href && item.id === currentId ? "page" : void 0, "aria-expanded": item.expanded, "aria-controls": item.controls, "data-sidebar-rail-item": item.id, "data-sidebar-rail-index": index, className: styles.item(), style: { ...props.style, ...sizing.item }, onClick: () => onSelect?.(item.id), children: [
          showLabels && /* @__PURE__ */ jsx("span", { "data-sidebar-rail-label": true, className: styles.label(), style: sizing.label, children: item.label }),
          " ",
          /* @__PURE__ */ jsx("span", { "data-sidebar-rail-face": true, className: styles.face(), style: sizing.face, children: item.badge !== void 0 || item.status ? /* @__PURE__ */ jsx(Indicator, { className: styles.badgeAnchor(), marker: item.badge !== void 0 && /* @__PURE__ */ jsx(Badge, { tone: item.badgeTone ?? "neutral", variant: "filled", className: styles.badge(), "aria-hidden": "true", children: navigationBadge(item.badge) }), children: /* @__PURE__ */ jsx(Indicator, { position: "bottom-end", className: styles.statusAnchor(), marker: item.status && /* @__PURE__ */ jsx(StatusIndicator, { label: item.status.label, tone: item.status.tone, showLabel: false, "aria-hidden": "true" }), children: glyph }) }) : glyph })
        ] }) })
      ] }, item.id);
    }) }) }),
    /* @__PURE__ */ jsx("div", { "data-sidebar-rail-region": "bottom", className: styles.region(), children: bottom })
  ] });
}
export {
  SidebarRail
};
