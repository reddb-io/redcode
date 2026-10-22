"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { Card, GridList, Heading, Link } from "@reddb-io/design-system/base";
import { productList } from "../../src/composites/product-list.variants.js";
function ProductList({ label, items, columns = 2, empty, headingLevel = 3, className, ...rest }) {
  const id = useId(), styles = productList({ columns });
  return /* @__PURE__ */ jsx(GridList, { ...rest, "data-product-list": true, "aria-label": label, columns, gap: "md", className: styles.root({ class: className }), children: items.length ? items.map((item, index) => /* @__PURE__ */ jsx("li", { className: styles.item(), children: /* @__PURE__ */ jsxs(Card, { "data-product-list-item": true, role: "article", "aria-labelledby": `${id}-product-${index}-name`, padding: "sm", footer: item.actions, className: styles.card(), header: /* @__PURE__ */ jsxs("div", { className: styles.identity(), children: [
    /* @__PURE__ */ jsx(Heading, { level: headingLevel, role: "heading", id: `${id}-product-${index}-name`, "data-product-list-name": true, className: styles.name(), children: item.href ? /* @__PURE__ */ jsx(Link, { href: item.href, children: item.name }) : item.name }),
    item.price && /* @__PURE__ */ jsx("p", { "data-product-list-price": true, className: styles.price(), children: item.price })
  ] }), children: [
    item.media && /* @__PURE__ */ jsx("div", { "data-product-list-media": true, className: styles.media(), children: item.media }),
    item.description && /* @__PURE__ */ jsx("p", { "data-product-list-description": true, className: styles.description(), children: item.description })
  ] }) }, item.id)) : /* @__PURE__ */ jsx("li", { "data-product-list-empty": true, className: styles.empty(), children: empty ?? "No products available." }) });
}
export {
  ProductList
};
