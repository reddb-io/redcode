"use client";
import { jsx } from "react/jsx-runtime";
import { Toolbar as Managed } from "@base-ui/react/toolbar";
import { Button, Link, quietControl } from "@reddb-io/design-system/base";
import { toolbar } from "../../src/composites/toolbar.variants.js";
function Toolbar({ label, items = [], orientation = "horizontal", size = "md", loop = true, className }) {
  const styles = toolbar({ orientation, size });
  return /* @__PURE__ */ jsx(Managed.Root, { orientation, loopFocus: loop, "data-command-toolbar": true, "aria-label": label, "aria-orientation": orientation, className: styles.root({ class: className }), children: items.map((item) => item.href !== void 0 && !item.disabled ? /* @__PURE__ */ jsx(Managed.Link, { render: /* @__PURE__ */ jsx(Link, { href: item.href, className: quietControl({ class: styles.item({ class: "rounded-md no-underline" }) }) }), "data-toolbar-item": true, children: item.label }, item.id) : /* @__PURE__ */ jsx(Managed.Button, { disabled: item.disabled, focusableWhenDisabled: false, render: /* @__PURE__ */ jsx(Button, { disabled: item.disabled, variant: "ghost", size, className: styles.item() }), "data-toolbar-item": true, onClick: () => item.onselect?.(), children: item.label }, item.id)) });
}
export {
  Toolbar
};
