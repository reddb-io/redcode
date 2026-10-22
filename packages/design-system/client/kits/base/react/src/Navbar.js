"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useId, useRef } from "react";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";
import { Link } from "./Link.js";
import { arrangements } from "../../src/core/navbar.js";
import { navbar } from "../../src/navbar.variants.js";
import { quietControl } from "../../src/quiet-control.variants.js";
import { useNavigationDisclosure } from "./navigation-disclosures.js";
import { useValue } from "./state.js";
function Navbar(props) {
  const { links = [], collapse = "responsive", align = "start", open = false, onOpenChange, label = "Main", menuLabel = "Menu", brand, actions, className } = props;
  const [active, setActive] = useValue(props.open, open, onOpenChange), id = useId(), toggle = useRef(null), styles = navbar({ collapse, align, open: active }), shown = arrangements(collapse);
  useNavigationDisclosure(active, () => setActive(false));
  const current = (item) => item.current === true || item.active ? "page" : item.current || void 0;
  const link = (item, compact) => {
    const classes = compact ? styles.panelLink() : styles.link(), choose = () => {
      item.onselect?.();
      if (compact) setActive(false);
    };
    return item.href !== void 0 ? item.disabled ? /* @__PURE__ */ jsx("a", { "aria-disabled": "true", "data-navbar-link": item.id, className: quietControl({ class: classes }), children: item.label }) : /* @__PURE__ */ jsx(Link, { href: item.href, "aria-current": current(item), "data-navbar-link": item.id, className: quietControl({ class: classes }), onClick: choose, children: item.label }) : /* @__PURE__ */ jsx(Button, { variant: "ghost", disabled: item.disabled, "aria-current": current(item), "data-navbar-link": item.id, className: classes, onClick: choose, children: item.label });
  };
  return /* @__PURE__ */ jsxs("nav", { "aria-label": label, "data-navbar": true, "data-navbar-align": align, "data-navbar-collapse": collapse, className: styles.root({ class: className }), onKeyDown: (event) => {
    if (event.key === "Escape" && active) {
      event.preventDefault();
      setActive(false);
      toggle.current?.focus();
    }
  }, children: [
    shown.rail && /* @__PURE__ */ jsxs("div", { "data-navbar-arrangement": "rail", className: styles.rail(), children: [
      /* @__PURE__ */ jsx("div", { "data-navbar-region": "brand", className: styles.brand(), children: brand }),
      links.length > 0 && /* @__PURE__ */ jsx("ul", { "data-navbar-region": "links", className: styles.links(), children: links.map((item) => /* @__PURE__ */ jsx("li", { className: styles.item(), children: link(item, false) }, item.id)) }),
      /* @__PURE__ */ jsx("div", { "data-navbar-region": "actions", className: styles.actions(), children: actions })
    ] }),
    shown.compact && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("div", { "data-navbar-arrangement": "compact", className: styles.compact(), children: [
        /* @__PURE__ */ jsx("div", { "data-navbar-region": "brand", className: styles.brand(), children: brand }),
        /* @__PURE__ */ jsxs(Button, { ref: toggle, variant: "ghost", className: styles.toggle(), "data-navbar-toggle": true, "aria-label": menuLabel, "aria-expanded": active, "aria-controls": `${id}-menu`, onClick: () => setActive(!active), children: [
          /* @__PURE__ */ jsx(Icon, { icon: "menu", size: "sm", "aria-hidden": "true" }),
          menuLabel
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { id: `${id}-menu`, "data-navbar-panel": true, hidden: !active, className: styles.panel(), children: [
        links.length > 0 && /* @__PURE__ */ jsx("ul", { "data-navbar-region": "links", className: styles.panelLinks(), children: links.map((item) => /* @__PURE__ */ jsx("li", { children: link(item, true) }, item.id)) }),
        /* @__PURE__ */ jsx("div", { "data-navbar-region": "actions", className: styles.actions(), children: actions })
      ] })
    ] })
  ] });
}
export {
  Navbar
};
