"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { MediaObject, SectionHeading, Stack } from "@reddb-io/design-system/base";
import { productFeature } from "../../src/composites/product-feature.variants.js";
function ProductFeature({ title, description, level = 2, mediaSide = "start", media, children, actions, className, ...rest }) {
  const id = useId(), styles = productFeature({ mediaSide });
  return /* @__PURE__ */ jsx(MediaObject, { ...rest, "data-product-feature": true, role: "region", "aria-labelledby": `${id}-title`, media, gap: "lg", mediaClass: styles.media(), contentClass: styles.content(), className: styles.root({ class: className }), children: /* @__PURE__ */ jsxs(Stack, { gap: "layout-sm", children: [
    /* @__PURE__ */ jsx(SectionHeading, { title, description, level, titleId: `${id}-title`, rule: false, className: styles.heading() }),
    children != null && children !== false && /* @__PURE__ */ jsx("div", { "data-product-feature-body": true, className: styles.body(), children }),
    actions != null && actions !== false && /* @__PURE__ */ jsx("div", { "data-product-feature-actions": true, className: styles.actions(), children: actions })
  ] }) });
}
export {
  ProductFeature
};
