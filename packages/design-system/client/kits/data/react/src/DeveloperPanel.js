"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Icon, Tabs, warnDeprecated, useControllableValue } from "@reddb-io/design-system/base";
import { DeveloperRequestInspector } from "./DeveloperRequestInspector.js";
import { clampDeveloperPanelHeight, developerPanelHeightForKey } from "../../src/developer-panel.js";
import { developerPanelClasses as styles } from "../../src/developer-panel.variants.js";
function DeveloperPanel(props) {
  const { label = "Developer panel", desktopOnly = false, requests, open: initialOpen = false, contained = false, onRequestsChange, children, contexts = [], contextContent, contextToolbar, toolbarContexts, headerActions, requestActions, className = "" } = props;
  const [open, setOpen] = useControllableValue(props.open, initialOpen, props.onOpenChange);
  const panelId = useId();
  const root = useRef(null);
  const drag = useRef(null);
  const [maximized, setMaximized] = useState(false);
  const [resizedHeight, setResizedHeight] = useState();
  const [measure, setMeasure] = useState({ height: 0, available: 0 });
  const available = () => contained ? root.current?.parentElement?.clientHeight ?? 0 : window.innerHeight;
  useEffect(() => {
    if (!root.current || !open) return;
    const element = root.current;
    const update = () => setMeasure({ height: element.getBoundingClientRect().height, available: contained ? element.parentElement?.clientHeight ?? 0 : window.innerHeight });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (contained && element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, contained]);
  const hasRequests = requests !== void 0;
  const entries = requests ?? [];
  const [context, setContext] = useState("requests");
  const contextItems = [...hasRequests ? [{ value: "requests", label: "Requests" }] : [], ...contexts.filter((item) => !hasRequests || item.value !== "requests")];
  useEffect(() => {
    if (hasRequests) warnDeprecated("DeveloperPanel", "requests", "DeveloperRequestInspector inside a Requests context");
  }, [hasRequests]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const handleHeader = (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("button, a, input, select, textarea, [role=tab]")) return;
      const header = target.closest("[data-developer-toolbar], [data-tabs-header]");
      if (header && (header.parentElement === element || header.parentElement?.parentElement?.parentElement === element)) setOpen(!open);
    };
    element.addEventListener("click", handleHeader);
    return () => element.removeEventListener("click", handleHeader);
  }, [open, setOpen]);
  const panelControls = /* @__PURE__ */ jsxs("div", { className: styles.headerActions, children: [
    headerActions,
    /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "md", className: "w-[var(--reddb-spatial-control-height-md)] min-w-[var(--reddb-spatial-control-height-md)] p-0", "aria-label": maximized ? "Restore panel size" : "Maximize panel", title: maximized ? "Restore panel size" : "Maximize panel", onClick: () => setMaximized(!maximized), children: /* @__PURE__ */ jsx(Icon, { icon: maximized ? "restore" : "maximize", size: "md", color: "current", "aria-hidden": "true" }) }),
    /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "lg", className: "w-[var(--reddb-spatial-control-height-lg)] min-w-[var(--reddb-spatial-control-height-lg)] p-0", "aria-label": "Close", title: "Close", onClick: () => setOpen(false), children: /* @__PURE__ */ jsx(Icon, { icon: "x", size: "md", color: "current", "aria-hidden": "true" }) })
  ] });
  return /* @__PURE__ */ jsxs("section", { ref: root, id: panelId, "aria-label": label, "data-developer-panel": true, "data-maximized": maximized && open, style: !open || resizedHeight === void 0 || maximized ? void 0 : { height: `${resizedHeight}px` }, className: `${styles.root} ${desktopOnly ? "hidden md:flex" : ""} ${contained ? "absolute max-h-full" : "fixed max-h-[100dvh]"} ${open ? maximized ? styles.maximized : styles.expanded : ""} ${className}`, children: [
    open && !maximized && /* @__PURE__ */ jsx("div", { className: styles.resize, role: "separator", tabIndex: 0, "aria-label": "Resize developer panel", "aria-controls": panelId, "aria-orientation": "horizontal", "aria-valuemin": Math.min(160, Math.round(measure.available)), "aria-valuemax": Math.round(measure.available), "aria-valuenow": Math.round(measure.height), onPointerDown: (event) => {
      if (event.button !== 0 || !root.current) return;
      event.preventDefault();
      drag.current = { y: event.clientY, height: root.current.getBoundingClientRect().height };
      event.currentTarget.setPointerCapture(event.pointerId);
    }, onPointerMove: (event) => {
      if (drag.current) setResizedHeight(clampDeveloperPanelHeight(drag.current.height + drag.current.y - event.clientY, available()));
    }, onPointerUp: () => {
      drag.current = null;
    }, onPointerCancel: () => {
      drag.current = null;
    }, onLostPointerCapture: () => {
      drag.current = null;
    }, onKeyDown: (event) => {
      if (!root.current) return;
      const next = developerPanelHeightForKey(event.key, root.current.getBoundingClientRect().height, available());
      if (next !== null) {
        event.preventDefault();
        setResizedHeight(next);
      }
    } }),
    !open ? /* @__PURE__ */ jsx("div", { "data-developer-toolbar": true, className: styles.collapsedToolbar, children: /* @__PURE__ */ jsxs(Button, { variant: "ghost", size: "sm", className: "w-full justify-start text-caption font-medium text-foreground", onClick: () => setOpen(true), "aria-expanded": false, children: [
      label,
      hasRequests && ` \xB7 ${entries.length}`
    ] }) }) : contextItems.length === 0 ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("div", { "data-developer-toolbar": true, className: styles.toolbar, children: [
        /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", className: "text-body font-medium text-foreground", onClick: () => setOpen(false), "aria-expanded": true, children: label }),
        panelControls
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex min-h-0 flex-1 flex-col overflow-hidden", children: [
        contextToolbar && (!toolbarContexts || toolbarContexts.includes("content")) && /* @__PURE__ */ jsx("div", { className: styles.contextToolbar, children: contextToolbar({ value: "content" }) }),
        /* @__PURE__ */ jsx("div", { className: styles.customBody, children: contextContent ? contextContent({ value: "content" }) : children })
      ] })
    ] }) : /* @__PURE__ */ jsx(
      Tabs,
      {
        label: "Developer contexts",
        items: contextItems,
        triggerClass: "text-caption",
        value: context,
        onValueChange: setContext,
        className: styles.contexts,
        listClass: "order-last basis-full self-end [&>button]:shrink-0 @lg:order-none @lg:basis-auto",
        contentClass: styles.contextBody,
        leading: /* @__PURE__ */ jsxs(Button, { variant: "ghost", size: "sm", className: "self-center text-body font-medium text-foreground", onClick: () => setOpen(false), "aria-expanded": true, children: [
          label,
          hasRequests && ` \xB7 ${entries.length}`
        ] }),
        actions: panelControls,
        children: ({ value: activeContext }) => /* @__PURE__ */ jsxs(Fragment, { children: [
          contextToolbar && (!toolbarContexts || toolbarContexts.includes(activeContext)) && /* @__PURE__ */ jsx("div", { className: styles.contextToolbar, children: contextToolbar({ value: activeContext }) }),
          hasRequests && activeContext === "requests" ? /* @__PURE__ */ jsx("div", { className: styles.customBody, children: /* @__PURE__ */ jsx(DeveloperRequestInspector, { requests: entries, onRequestsChange, requestActions, children }) }) : /* @__PURE__ */ jsx("div", { className: styles.customBody, children: contextContent ? contextContent({ value: activeContext }) : !hasRequests ? children : null })
        ] })
      }
    )
  ] });
}
var DeveloperPanel_default = DeveloperPanel;
export {
  DeveloperPanel,
  DeveloperPanel_default as default
};
