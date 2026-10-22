import { jsx } from "react/jsx-runtime";
import { scrollArea } from "../../src/scroll-area.variants.js";
function ScrollArea({ label, orientation = "vertical", variant = "outline", className, children, ...rest }) {
  return /* @__PURE__ */ jsx("div", { ...rest, "data-scroll-area": true, role: "region", "aria-label": label, tabIndex: 0, className: scrollArea({ orientation, variant, class: className }), children });
}
export {
  ScrollArea
};
