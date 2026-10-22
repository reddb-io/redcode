"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useContext, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Badge, Button, Drawer, Icon, Stack, StatusIndicator, NavigationDisclosureContext, createNavigationDisclosures, useControllableValue } from "@reddb-io/design-system/base";
import { MainLandmarkContext } from "./layout-state.js";
import { SidebarRail } from "./SidebarRail.js";
import { BottomNavigation } from "./BottomNavigation.js";
import { NavItem } from "./NavItem.js";
import { observeElementSize } from "../../src/core/measure.js";
import { navigationBadge, navigationItems, navigationMarkerLabel } from "../../src/composites/navigation.behavior.js";
import { responsiveNavigationLayout, sidebarLayout } from "../../src/composites/sidebar-layout.variants.js";
function SidebarLayout(props) {
  const { side = "start", sidebarLabel = "Sidebar", mainId, main, sidebar, navigation, header, dockable = true, currentId, navigationLabel = "Main navigation", showRailLabels = false, moreLabel = "More", rail, railOpen = true, panelOpen = false, onPanelOpenChange, children, gap = "layout-md", className, style, ref, ...rest } = props;
  const owned = useContext(MainLandmarkContext), rendersMain = main ?? !owned, regionId = rendersMain ? mainId ?? "main-content" : mainId, Main = rendersMain ? "main" : "div";
  const [active, setActive] = useControllableValue(props.panelOpen, panelOpen, onPanelOpenChange), [sectionId, setSectionId] = useState(() => navigation?.find((item) => item.id === currentId && !item.href)?.id), [moreOpen, setMoreOpen] = useState(false), [compact, setCompact] = useState(false);
  const [railWidth, setRailWidth] = useState(0), [headerHeight, setHeaderHeight] = useState(0), [bottomHeight, setBottomHeight] = useState(0);
  const root = useRef(null), railElement = useRef(null), headerElement = useRef(null), bottomElement = useRef(null), id = useId(), menuId = `${id}-navigation-menu`, moreId = `${id}-more`;
  const coordinator = useRef(null);
  coordinator.current ??= createNavigationDisclosures();
  const registration = useRef(void 0), previous = useRef(currentId);
  const latest = useRef({ navigation, compact, active, sectionId, currentId });
  latest.current = { navigation, compact, active, sectionId, currentId };
  useImperativeHandle(ref, () => root.current, []);
  const hasRail = rail !== void 0, styles = sidebarLayout({ side, rail: hasRail, railOpen, panelOpen: active });
  let primary = [];
  if (navigation) {
    if (rail) throw new Error("SidebarLayout: choose navigation items or a rail snippet, not both");
    if (new Set(navigation.map((item) => item.id)).size !== navigation.length) throw new Error("SidebarLayout navigation ids must be unique");
    if (!currentId) throw new Error("SidebarLayout navigation requires currentId");
    primary = navigationItems(navigation, currentId);
  }
  const section = primary.find((item) => item.id === sectionId && !item.href), overflow = primary.length > 5 ? primary.slice(4) : [], mainItems = overflow.length ? primary.slice(0, 4) : primary;
  const frame = responsiveNavigationLayout({ side, dockable, header: header !== void 0, panel: section !== void 0 });
  const close = () => {
    setActive(false);
    setMoreOpen(false);
    if (!compact) setSectionId(void 0);
  };
  const activate = (item) => {
    if (item.disabled) return;
    item.onselect?.();
    setMoreOpen(false);
    if (item.href) {
      setSectionId(void 0);
      setActive(false);
    } else {
      setSectionId(item.id);
      setActive(true);
      if (compact) setTimeout(() => {
        if (latest.current.active) document.getElementById(menuId)?.querySelector("[data-dialog-body] input:not(:disabled), [data-dialog-body] a[href], [data-dialog-body] button:not(:disabled)")?.focus();
      }, 0);
    }
  };
  useEffect(() => observeElementSize(railElement.current, (rect) => setRailWidth(rect.width)), [rail]);
  useEffect(() => observeElementSize(headerElement.current, (rect) => setHeaderHeight(rect.height)), [header]);
  useEffect(() => observeElementSize(bottomElement.current, (rect) => {
    if (rect.height) setBottomHeight(rect.height);
  }), [navigation]);
  useEffect(() => {
    registration.current = coordinator.current.register(() => {
      if (latest.current.navigation && latest.current.compact) setActive(false);
    });
    return () => registration.current?.destroy();
  }, [setActive]);
  useEffect(() => {
    if (navigation && compact && active) registration.current?.open();
  }, [navigation, compact, active]);
  useEffect(() => {
    if (!navigation || currentId === previous.current) return;
    previous.current = currentId;
    setSectionId(navigation.find((item) => item.id === currentId && !item.href)?.id);
    setMoreOpen(false);
    setActive(false);
  }, [navigation, currentId, setActive]);
  useEffect(() => {
    if (!navigation || typeof matchMedia !== "function") return;
    const step = getComputedStyle(document.documentElement).getPropertyValue("--reddb-breakpoint-md").trim(), query = matchMedia(`(max-width: calc(${step} - 0.02px))`);
    setCompact(query.matches);
    const resize = () => {
      const wasOpen = latest.current.active;
      setCompact(query.matches);
      setActive(false);
      setMoreOpen(false);
      if (wasOpen && !query.matches) setTimeout(() => [...root.current?.querySelectorAll("[data-primary-navigation-rail] [data-sidebar-rail-item]") ?? []].find((element) => element.dataset.sidebarRailItem === (latest.current.sectionId ?? latest.current.currentId))?.focus(), 0);
    };
    const back = () => {
      setActive(false);
      setMoreOpen(false);
    };
    query.addEventListener("change", resize);
    window.addEventListener("popstate", back);
    return () => {
      query.removeEventListener("change", resize);
      window.removeEventListener("popstate", back);
    };
  }, [Boolean(navigation), setActive]);
  useEffect(() => {
    if (!hasRail) return;
    const escape = (event) => {
      if (event.key === "Escape" && latest.current.active) setActive(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [hasRail, setActive]);
  const closeAfterDestination = (event) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (anchor && anchor.getAttribute("target") !== "_blank" && !anchor.hasAttribute("download")) setActive(false);
  };
  const contextualMenu = /* @__PURE__ */ jsx("div", { className: frame.menu(), onClick: closeAfterDestination, "data-primary-contextual-menu": true, children: sidebar?.({ item: section, close }) });
  const mainRegion = (classes) => /* @__PURE__ */ jsx(Main, { id: regionId, tabIndex: regionId ? -1 : void 0, className: classes, "data-sidebar-layout-region": "main", children: /* @__PURE__ */ jsx(Stack, { gap, children }) });
  const bottomItems = mainItems.map((item) => ({ ...item, expanded: item.href ? void 0 : active && !moreOpen && section?.id === item.id, controls: item.href ? void 0 : menuId, onselect: () => activate(item) }));
  if (overflow.length) {
    const badge = overflow.reduce((total, item) => total + (typeof item.badge === "number" ? item.badge : 0), 0);
    bottomItems.push({ id: moreId, label: moreLabel, fallback: "\xB7\xB7\xB7", current: false, expanded: active && moreOpen, controls: menuId, badge: badge || void 0, onselect: () => {
      setMoreOpen(true);
      setActive(true);
    } });
  }
  const legacyRail = /* @__PURE__ */ jsx("div", { ref: railElement, className: styles.railRegion(), "data-sidebar-layout-region": "rail", hidden: !railOpen, children: rail });
  const legacyPanel = /* @__PURE__ */ jsx("aside", { "aria-label": sidebarLabel, inert: hasRail && !active || void 0, className: hasRail ? styles.panel() : styles.region({ class: styles.sidebar() }), "data-sidebar-layout-region": "sidebar", "data-mobile-presentation": hasRail ? "drawer" : void 0, "data-state": hasRail ? active ? "open" : "closed" : void 0, children: /* @__PURE__ */ jsx(Stack, { gap, children: sidebar?.({ item: void 0, close: () => setActive(false) }) }) });
  const backdrop = hasRail && active && /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Close sidebar panel", "data-sidebar-drawer-backdrop": true, className: "fixed inset-0 z-30 bg-foreground/20 md:hidden", onClick: () => setActive(false) });
  const output = navigation ? /* @__PURE__ */ jsxs("div", { ...rest, ref: root, "data-sidebar-layout": true, "data-sidebar-layout-mode": "navigation", "data-side": side, className: frame.root({ class: className }), style: { ...style, "--_reddb-navigation-bottom-height": dockable && compact && bottomHeight ? `${bottomHeight}px` : "0px", "--_reddb-navigation-header-height": `${headerHeight}px`, paddingBottom: dockable && compact && bottomHeight ? `${bottomHeight}px` : style?.paddingBottom }, children: [
    header != null && header !== false && /* @__PURE__ */ jsx("div", { ref: headerElement, className: frame.header(), "data-primary-navigation-header": true, children: header }),
    /* @__PURE__ */ jsx("div", { className: frame.rail(), style: { height: headerHeight ? `calc(100dvh - ${headerHeight}px)` : void 0 }, "data-primary-navigation-rail": true, children: /* @__PURE__ */ jsx(SidebarRail, { label: navigationLabel, showLabels: showRailLabels, items: primary.map((item) => ({ ...item, expanded: item.href ? void 0 : section?.id === item.id, controls: item.href ? void 0 : menuId })), currentId, onSelect: (id2) => {
      const item = primary.find((item2) => item2.id === id2);
      if (item) activate(item);
    } }) }),
    !compact && section && /* @__PURE__ */ jsxs("aside", { id: menuId, "aria-label": section.label, className: frame.panel(), style: { height: headerHeight ? `calc(100dvh - ${headerHeight}px)` : void 0 }, "data-primary-navigation-panel": true, children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-[var(--reddb-spatial-gap-md)] border-b border-muted p-[var(--reddb-spatial-inset-md)]", children: [
        /* @__PURE__ */ jsx("h2", { className: "m-0 text-heading", children: section.label }),
        /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", "aria-label": `Close ${section.label}`, onClick: close, children: "Close" })
      ] }),
      contextualMenu
    ] }),
    mainRegion(frame.main()),
    dockable && /* @__PURE__ */ jsx("div", { ref: bottomElement, className: frame.bottom(), "data-primary-navigation-bottom": true, children: /* @__PURE__ */ jsx(BottomNavigation, { label: navigationLabel, items: bottomItems, currentId: mainItems.some((item) => item.id === currentId) ? currentId : moreId }) }),
    compact && /* @__PURE__ */ jsx(Drawer, { id: menuId, side: side === "start" ? "left" : "right", title: moreOpen ? moreLabel : section?.label ?? sidebarLabel, open: active, onOpenChange: setActive, className: frame.drawer(), "data-primary-navigation-drawer": true, children: moreOpen ? /* @__PURE__ */ jsx("nav", { "aria-label": moreLabel, className: frame.more(), children: overflow.map((item) => /* @__PURE__ */ jsx(NavItem, { label: item.label, "aria-label": navigationMarkerLabel(item, item.label), href: item.href, current: item.id === currentId, disabled: item.disabled, icon: item.icon ? /* @__PURE__ */ jsx(Icon, { icon: item.icon, size: "md", color: "current", "aria-hidden": "true" }) : void 0, trailing: /* @__PURE__ */ jsxs(Fragment, { children: [
      item.badge !== void 0 && /* @__PURE__ */ jsx(Badge, { tone: item.badgeTone ?? "neutral", "aria-hidden": "true", children: navigationBadge(item.badge) }),
      item.status && /* @__PURE__ */ jsx(StatusIndicator, { label: item.status.label, tone: item.status.tone, showLabel: false, "aria-hidden": "true" })
    ] }), "data-primary-overflow-item": item.id, onClick: () => activate(item) }, item.id)) }) : contextualMenu })
  ] }) : /* @__PURE__ */ jsx("div", { ...rest, ref: root, "data-sidebar-layout": true, style: { ...style, "--_reddb-sidebar-rail-width": hasRail && railWidth ? `${railWidth}px` : void 0 }, "data-side": side, "data-sidebar-layout-mode": hasRail ? "rail-panel" : "panel", "data-rail-open": hasRail ? railOpen : void 0, "data-panel-open": hasRail ? active : void 0, className: styles.root({ class: className }), children: side === "start" ? /* @__PURE__ */ jsxs(Fragment, { children: [
    hasRail && legacyRail,
    backdrop,
    legacyPanel,
    mainRegion(hasRail ? styles.main() : styles.region({ class: styles.content() }))
  ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
    mainRegion(hasRail ? styles.main() : styles.region({ class: styles.content() })),
    legacyPanel,
    backdrop,
    hasRail && legacyRail
  ] }) });
  return /* @__PURE__ */ jsx(MainLandmarkContext, { value: owned || rendersMain, children: /* @__PURE__ */ jsx(NavigationDisclosureContext, { value: coordinator.current, children: output }) });
}
export {
  SidebarLayout
};
