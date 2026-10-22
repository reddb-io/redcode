"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { NavigationMenu as Managed } from "@base-ui/react/navigation-menu";
import { Button } from "./Button.js";
import { isNavigationMenuSection } from "../../src/navigation-menu.behavior.js";
import { navigationMenu } from "../../src/navigation-menu.variants.js";
import { popover } from "../../src/popover.variants.js";
import { quietControl } from "../../src/quiet-control.variants.js";
import { usePortalAppearance, useValue } from "./state.js";
function NavigationMenu(props) {
  const { label, items = [], value = "", onValueChange, orientation = "horizontal", size = "md", delayDuration = 200, skipDelayDuration = 300, className } = props;
  const [current, setCurrent] = useValue(props.value, value, onValueChange), styles = navigationMenu({ orientation, size }), root = useRef(null), portal = usePortalAppearance(root, !!current);
  return /* @__PURE__ */ jsxs(Managed.Root, { ref: root, "aria-label": label, "data-navigation-menu-root": true, className: styles.root(), value: current || null, onValueChange: (next, details) => {
    if (details.reason === "trigger-hover") {
      details.cancel();
      return;
    }
    setCurrent(next ?? "");
  }, orientation, delay: delayDuration, closeDelay: skipDelayDuration, children: [
    /* @__PURE__ */ jsx(Managed.List, { className: styles.list(), children: items.map((item) => /* @__PURE__ */ jsx(Managed.Item, { value: item.id, children: isNavigationMenuSection(item) ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Managed.Trigger, { render: /* @__PURE__ */ jsx(Button, { variant: "ghost", size, className: styles.control() }), "data-navigation-menu-control": true, "data-navigation-menu-trigger": true, children: item.label }),
      /* @__PURE__ */ jsx(Managed.Content, { "data-navigation-menu-surface": true, "aria-label": item.label, className: popover({ class: styles.content({ class: className }) }), children: /* @__PURE__ */ jsx("ul", { className: styles.links(), children: item.links.map((link) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs(Managed.Link, { href: link.href, active: link.active, "aria-current": link.active ? "page" : void 0, onClick: () => link.onselect?.(), className: quietControl({ ink: "foreground", class: styles.link() }), children: [
        /* @__PURE__ */ jsx("span", { children: link.label }),
        link.description !== void 0 && /* @__PURE__ */ jsx("span", { className: styles.description(), children: link.description })
      ] }) }, link.id)) }) }),
      current !== item.id && /* @__PURE__ */ jsx("ul", { hidden: true, "data-navigation-menu-closed-links": item.id, children: item.links.map((link) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs("a", { href: link.href, "aria-current": link.active ? "page" : void 0, children: [
        link.label,
        link.description !== void 0 && /* @__PURE__ */ jsxs("span", { children: [
          " \u2014 ",
          link.description
        ] })
      ] }) }, link.id)) })
    ] }) : /* @__PURE__ */ jsx(Managed.Link, { href: item.href, active: item.active, "aria-current": item.active ? "page" : void 0, "data-navigation-menu-control": true, onClick: () => item.onselect?.(), className: quietControl({ ink: "foreground", class: styles.control() }), children: item.label }) }, item.id)) }),
    /* @__PURE__ */ jsx(Managed.Portal, { container: portal.container, children: /* @__PURE__ */ jsx(Managed.Positioner, { ...portal.attributes, side: orientation === "vertical" ? "right" : "bottom", align: "start", sideOffset: 8, collisionPadding: 8, children: /* @__PURE__ */ jsx(Managed.Popup, { render: /* @__PURE__ */ jsx("div", {}), children: /* @__PURE__ */ jsx(Managed.Viewport, {}) }) }) })
  ] });
}
export {
  NavigationMenu
};
