"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { AspectRatio, Card, Heading, Link } from "@reddb-io/design-system/base";
import { categoryPreview } from "../../src/composites/category-preview.variants.js";
function CategoryPreview({ name, href, description, media, ratio = 4 / 3, headingLevel = 3, className, ...rest }) {
  const id = useId(), styles = categoryPreview();
  return /* @__PURE__ */ jsxs(Card, { ...rest, "data-category-preview": true, role: "article", "aria-labelledby": `${id}-link`, variant: "plain", padding: "none", className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx(AspectRatio, { ratio, className: styles.media(), children: media }),
    /* @__PURE__ */ jsxs("div", { "data-category-preview-content": true, className: styles.content(), children: [
      /* @__PURE__ */ jsx(Heading, { level: headingLevel, role: "heading", className: styles.name(), children: /* @__PURE__ */ jsx(Link, { id: `${id}-link`, href, children: name }) }),
      description && /* @__PURE__ */ jsx("p", { className: styles.description(), children: description })
    ] })
  ] });
}
export {
  CategoryPreview
};
