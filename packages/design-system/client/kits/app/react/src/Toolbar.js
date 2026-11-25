"use client";
import { jsx } from "react/jsx-runtime";
import { useLayoutEffect, useRef, useState } from "react";
import { Toolbar as Managed } from "@base-ui/react/toolbar";
import { Button, DropdownMenu, Link, quietControl } from "@reddb-io/design-system/base";
import { collapseTail, observeRowCollapse, rowEntries } from "@reddb-io/design-system/base/recipes";
import { toolbarMenuItems, toolbarOverflow } from "../../src/composites/command-surfaces.behavior.js";
import { toolbar } from "../../src/composites/toolbar.variants.js";
function Toolbar({ label, items = [], orientation = "horizontal", size = "md", loop = true, overflow = "wrap", moreLabel = "More", className }) {
  const policy = toolbarOverflow(orientation, overflow), styles = toolbar({ orientation, size, overflow: policy });
  const root = useRef(null), observer = useRef(void 0), latest = useRef(items);
  latest.current = items;
  const [hidden, setHidden] = useState([]);
  useLayoutEffect(() => {
    if (policy !== "collapse" || !root.current) return;
    const active = observeRowCollapse(root.current, { ids: () => latest.current.map((item) => item.id), plan: collapseTail, onchange: setHidden });
    observer.current = active;
    return () => {
      active.disconnect();
      observer.current = void 0;
      setHidden([]);
    };
  }, [policy]);
  useLayoutEffect(() => {
    observer.current?.update();
  }, [items, hidden]);
  const entries = rowEntries(items, policy === "collapse" ? hidden : []);
  const marker = (id) => policy === "collapse" ? id : void 0;
  return /* @__PURE__ */ jsx(Managed.Root, { ref: root, orientation, loopFocus: loop, "data-command-toolbar": true, "data-overflow": policy, "aria-label": label, "aria-orientation": orientation, className: styles.root({ class: className }), children: entries.map((entry) => {
    if (entry.kind === "more") return /* @__PURE__ */ jsx("span", { "data-overflow-more": true, className: styles.more(), children: /* @__PURE__ */ jsx(DropdownMenu, { triggerLabel: moreLabel, contentLabel: `${label}: ${moreLabel}`, items: toolbarMenuItems(entry.items), variant: "ghost", size, align: "end" }) }, "\0more");
    const item = entry.item;
    return item.href !== void 0 && !item.disabled ? /* @__PURE__ */ jsx(Managed.Link, { render: /* @__PURE__ */ jsx(Link, { href: item.href, className: quietControl({ class: styles.item({ class: "rounded-md no-underline" }) }) }), "data-toolbar-item": true, "data-overflow-item": marker(item.id), children: item.label }, item.id) : /* @__PURE__ */ jsx(Managed.Button, { disabled: item.disabled, focusableWhenDisabled: false, render: /* @__PURE__ */ jsx(Button, { disabled: item.disabled, variant: "ghost", size, className: styles.item() }), "data-toolbar-item": true, "data-overflow-item": marker(item.id), onClick: () => item.onselect?.(), children: item.label }, item.id);
  }) });
}
export {
  Toolbar
};
