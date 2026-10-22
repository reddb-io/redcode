"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { Image, SectionHeading, Stack } from "@reddb-io/design-system/base";
import { productOverview } from "../../src/composites/product-overview.variants.js";
function ProductOverview({ title, description, price, level = 2, media, image, priority = false, children, actions, className, ...rest }) {
  const id = useId(), styles = productOverview();
  return /* @__PURE__ */ jsxs("section", { ...rest, "data-product-overview": true, "aria-labelledby": `${id}-title`, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx("div", { "data-product-overview-media": true, className: styles.media(), children: media ?? (image && /* @__PURE__ */ jsx(Image, { ...image, priority, className: "w-full" })) }),
    /* @__PURE__ */ jsxs(Stack, { gap: "layout-sm", className: styles.content(), children: [
      /* @__PURE__ */ jsx(SectionHeading, { title, description, level, titleId: `${id}-title`, rule: false, className: styles.heading() }),
      price && /* @__PURE__ */ jsx("p", { "data-product-overview-price": true, className: styles.price(), children: price }),
      children != null && children !== false && /* @__PURE__ */ jsx("div", { "data-product-overview-body": true, className: styles.body(), children }),
      actions != null && actions !== false && /* @__PURE__ */ jsx("div", { "data-product-overview-actions": true, className: styles.actions(), children: actions })
    ] })
  ] });
}
export {
  ProductOverview
};
