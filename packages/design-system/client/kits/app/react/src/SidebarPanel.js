import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Badge, Button, ScrollArea, StatusIndicator } from "@reddb-io/design-system/base";
import { navigationBadge, navigationMarkerLabel } from "../../src/composites/navigation.behavior.js";
import { sidebarPanel } from "../../src/composites/sidebar-panel.variants.js";
function SidebarPanel({ title, badge, badgeLabel, badgeTone = "neutral", status, headingLevel = 2, backHref, backLabel = "Back", onDismiss, toolbar, actions, controls, children, footer, className, ...rest }) {
  const styles = sidebarPanel(), Tag = `h${headingLevel}`;
  return /* @__PURE__ */ jsxs("section", { ...rest, "data-sidebar-panel": true, "aria-label": navigationMarkerLabel({ badge, badgeLabel, status }, title), className: styles.root({ class: className }), children: [
    (toolbar || backHref || onDismiss) && /* @__PURE__ */ jsx("div", { "data-sidebar-panel-toolbar": true, className: styles.toolbar(), children: toolbar ?? /* @__PURE__ */ jsxs(Fragment, { children: [
      backHref ? /* @__PURE__ */ jsx(Button, { href: backHref, variant: "ghost", size: "sm", children: backLabel }) : /* @__PURE__ */ jsx("span", {}),
      onDismiss && /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", "aria-label": `Close ${title}`, onClick: onDismiss, children: "Close" })
    ] }) }),
    /* @__PURE__ */ jsxs("div", { className: styles.header(), children: [
      /* @__PURE__ */ jsxs("div", { className: "flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]", children: [
        /* @__PURE__ */ jsx(Tag, { className: "m-0 min-w-0 break-words text-heading", children: title }),
        badge !== void 0 && /* @__PURE__ */ jsx(Badge, { tone: badgeTone, variant: "filled", role: "img", "aria-label": badgeLabel ?? `${badge} notifications`, children: navigationBadge(badge) }),
        status && /* @__PURE__ */ jsx(StatusIndicator, { label: status.label, tone: status.tone, showLabel: false })
      ] }),
      actions != null && actions !== false && /* @__PURE__ */ jsx("div", { "data-sidebar-panel-actions": true, className: styles.actions(), children: actions })
    ] }),
    controls && /* @__PURE__ */ jsx("div", { "data-sidebar-panel-controls": true, className: styles.controls(), children: controls }),
    /* @__PURE__ */ jsx(ScrollArea, { label: `${title} items`, variant: "plain", className: styles.body(), children }),
    footer != null && footer !== false && /* @__PURE__ */ jsx("div", { "data-sidebar-panel-footer": true, className: styles.footer(), children: footer })
  ] });
}
export {
  SidebarPanel
};
