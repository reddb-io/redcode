import { jsx, jsxs } from "react/jsx-runtime";
import { indicator } from "../../src/indicator.variants.js";
function Indicator({ marker, children, position = "top-end", className, ...rest }) {
  const slots = indicator({ position });
  return /* @__PURE__ */ jsxs("span", { ...rest, "data-indicator": true, className: slots.root({ class: className }), children: [
    /* @__PURE__ */ jsx("span", { "data-indicator-marker": true, className: slots.marker(), children: marker }),
    " ",
    children
  ] });
}
export {
  Indicator
};
