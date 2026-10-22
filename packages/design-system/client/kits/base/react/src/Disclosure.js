"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { Collapsible as Managed } from "@base-ui/react/collapsible";
import { Button } from "./Button.js";
import { disclosure } from "../../src/disclosure.variants.js";
import { useValue } from "./state.js";
function Disclosure(props) {
  const { label, open = false, disabled = false, children, triggerClass, contentClass, onOpenChange, className } = props;
  const [active, setActive] = useValue(props.open, open, onOpenChange), id = useId(), styles = disclosure();
  return /* @__PURE__ */ jsxs(Managed.Root, { open: active, onOpenChange: setActive, disabled, "data-disclosure": true, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsxs(Managed.Trigger, { render: /* @__PURE__ */ jsx(Button, { id: `${id}-trigger`, variant: "secondary", size: "sm", className: styles.trigger({ class: triggerClass }) }), children: [
      label,
      /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.indicator(), children: "\u2304" })
    ] }),
    /* @__PURE__ */ jsx(Managed.Panel, { role: "region", "aria-labelledby": `${id}-trigger`, className: styles.content({ class: contentClass }), children })
  ] });
}
export {
  Disclosure
};
