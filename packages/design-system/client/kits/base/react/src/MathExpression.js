import { jsx } from "react/jsx-runtime";
import { mathExpression } from "../../src/math-expression.variants.js";
function MathExpression({ display = "inline", children, label = "Mathematical expression", className }) {
  const Tag = display === "block" ? "div" : "span";
  return /* @__PURE__ */ jsx(Tag, { "data-math-expression": true, role: display === "block" ? "region" : void 0, "aria-label": display === "block" ? label : void 0, tabIndex: display === "block" ? 0 : void 0, className: mathExpression({ display, class: className }), children });
}
export {
  MathExpression
};
