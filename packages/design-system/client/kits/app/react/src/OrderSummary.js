"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { Card, DescriptionList, SectionHeading } from "@reddb-io/design-system/base";
import { orderSummary } from "../../src/composites/order-summary.variants.js";
function OrderSummary({ title, level = 2, lines, totalLabel, total, actions, className, ...rest }) {
  const id = useId(), styles = orderSummary();
  return /* @__PURE__ */ jsx(Card, { ...rest, "data-order-summary": true, role: "region", "aria-labelledby": rest["aria-label"] ? void 0 : `${id}-title`, className: styles.root({ class: className }), header: /* @__PURE__ */ jsx(SectionHeading, { id: `${id}-title`, title, level, rule: false, className: styles.heading() }), footer: actions != null && actions !== false && /* @__PURE__ */ jsx("div", { "data-order-summary-actions": true, className: styles.actions(), children: actions }), children: /* @__PURE__ */ jsxs("div", { className: styles.content(), children: [
    /* @__PURE__ */ jsx(DescriptionList, { items: lines.map((line) => ({ term: line.label, detail: line.value })) }),
    /* @__PURE__ */ jsxs("div", { "data-order-summary-total": true, className: styles.total(), children: [
      /* @__PURE__ */ jsx("span", { children: totalLabel }),
      /* @__PURE__ */ jsx("output", { "aria-live": "polite", "aria-atomic": "true", children: total })
    ] })
  ] }) });
}
export {
  OrderSummary
};
