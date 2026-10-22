"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { Button, Field, Form, Input, List, SectionHeading } from "@reddb-io/design-system/base";
import { shoppingCart } from "../../src/composites/shopping-cart.appearance.js";
function ShoppingCart({ title, level = 2, items, totalLabel, total, empty, actions, className, itemClass, quantityClass, onQuantityChange, onRemove, ...rest }) {
  const id = useId(), styles = shoppingCart(), Tag = `h${Math.min(level + 1, 6)}`;
  return /* @__PURE__ */ jsxs(Form, { ...rest, "data-shopping-cart": true, "aria-labelledby": rest["aria-label"] ? void 0 : `${id}-title`, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx(SectionHeading, { id: `${id}-title`, title, level, rule: false, className: styles.heading() }),
    /* @__PURE__ */ jsx(List, { gap: "lg", className: styles.list(), children: items.length ? items.map((item, index) => /* @__PURE__ */ jsxs("li", { "data-cart-item": item.id, className: styles.item({ class: itemClass }), children: [
      /* @__PURE__ */ jsxs("div", { className: styles.details({ class: item.media ? "grid-cols-[calc(var(--reddb-spatial-control-height-md)*2)_minmax(0,1fr)]" : "grid-cols-1" }), children: [
        item.media && /* @__PURE__ */ jsx("div", { "data-cart-item-media": true, className: styles.media(), children: item.media }),
        /* @__PURE__ */ jsxs("div", { className: styles.identity(), children: [
          /* @__PURE__ */ jsx(Tag, { className: styles.name(), children: item.name }),
          item.details ?? /* @__PURE__ */ jsxs(Fragment, { children: [
            item.description && /* @__PURE__ */ jsx("p", { className: styles.description(), children: item.description }),
            /* @__PURE__ */ jsx("p", { className: styles.price(), children: item.price })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: styles.controls(), children: [
        /* @__PURE__ */ jsx(Field, { label: `Quantity for ${item.name}`, id: `${id}-${index}-quantity`, children: (control) => /* @__PURE__ */ jsx(Input, { ...control, name: item.quantityName ?? `quantity[${item.id}]`, type: "number", min: "0", inputMode: "numeric", value: item.quantity, disabled: item.disabled, className: styles.quantity({ class: quantityClass }), onValueChange: (quantity) => onQuantityChange?.(item.id, quantity ?? NaN) }) }),
        onRemove && /* @__PURE__ */ jsxs(Button, { type: "button", variant: "secondary", disabled: item.disabled, onClick: () => onRemove(item.id), children: [
          "Remove ",
          item.name
        ] }),
        item.actions && /* @__PURE__ */ jsx("div", { "data-cart-item-actions": true, className: styles.itemActions(), children: item.actions })
      ] })
    ] }, item.id)) : /* @__PURE__ */ jsx("li", { "data-cart-empty": true, className: styles.empty(), children: empty ?? "Your cart is empty." }) }),
    items.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("div", { "data-cart-total": true, className: styles.total(), children: [
        /* @__PURE__ */ jsx("span", { children: totalLabel }),
        /* @__PURE__ */ jsx("output", { "aria-live": "polite", "aria-atomic": "true", children: total })
      ] }),
      actions != null && actions !== false && /* @__PURE__ */ jsx("div", { "data-cart-actions": true, className: styles.actions(), children: actions })
    ] })
  ] });
}
export {
  ShoppingCart
};
