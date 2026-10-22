import { jsx, jsxs } from "react/jsx-runtime";
import { Dialog } from "@reddb-io/design-system/base";
import { productQuickview } from "../../src/composites/product-quickview.variants.js";
function ProductQuickview({ triggerLabel, title, description, trigger, media, children, actions, className, dialogClass, ...rest }) {
  const styles = productQuickview();
  return /* @__PURE__ */ jsx("div", { ...rest, "data-product-quickview": true, className: styles.root({ class: className }), children: /* @__PURE__ */ jsx(Dialog, { triggerLabel, title, description, trigger, actions, initialFocus: "body", className: styles.dialog({ class: dialogClass }), children: /* @__PURE__ */ jsxs("div", { "data-product-quickview-content": true, className: styles.content(), children: [
    media != null && media !== false && /* @__PURE__ */ jsx("div", { "data-product-quickview-media": true, className: styles.media(), children: media }),
    /* @__PURE__ */ jsx("div", { "data-product-quickview-body": true, className: styles.body(), children })
  ] }) }) });
}
export {
  ProductQuickview
};
