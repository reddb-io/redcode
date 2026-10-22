"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId, useRef } from "react";
import { Accordion as Managed } from "@base-ui/react/accordion";
import { Button } from "./Button.js";
import { accordion } from "../../src/accordion.variants.js";
import { toggleGroupTarget } from "../../src/core/toggle-group.js";
import { useValue } from "./state.js";
function Accordion({ label, items, value, multiple = false, disabled = false, onValueChange, children, className, triggerClass, contentClass }) {
  const [current, setCurrent] = useValue(value, [], onValueChange), id = useId(), styles = accordion(), element = useRef(null);
  const selected = multiple ? current : current.slice(-1);
  return /* @__PURE__ */ jsx(Managed.Root, { ref: element, multiple, value: selected, onValueChange: (next) => setCurrent(multiple ? next : next.slice(-1)), disabled, "data-accordion": true, "aria-label": label, className: styles.root({ class: className }), children: items.map((item, index) => /* @__PURE__ */ jsxs(Managed.Item, { value: item.value, disabled: item.disabled, className: styles.item(), children: [
    /* @__PURE__ */ jsx(Managed.Header, { className: styles.header(), children: /* @__PURE__ */ jsxs(Managed.Trigger, { render: /* @__PURE__ */ jsx(
      Button,
      {
        id: `${id}-${index}-trigger`,
        "aria-controls": `${id}-${index}-content`,
        variant: "ghost",
        size: "sm",
        className: styles.trigger({ class: triggerClass }),
        onKeyDown: (event) => {
          if (disabled) return;
          const next = toggleGroupTarget(items, index, event.key);
          if (next !== void 0) {
            event.preventDefault();
            element.current?.querySelectorAll("button[aria-expanded]")[next]?.focus();
          }
        }
      }
    ), children: [
      /* @__PURE__ */ jsx("span", { "data-accordion-label": true, className: styles.label(), children: item.label }),
      /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.indicator(), children: "\u2304" })
    ] }) }),
    /* @__PURE__ */ jsx(Managed.Panel, { id: `${id}-${index}-content`, role: "region", "aria-labelledby": `${id}-${index}-trigger`, className: styles.content({ class: contentClass }), children: children?.({ value: item.value }) })
  ] }, item.value)) });
}
export {
  Accordion
};
