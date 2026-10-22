import { jsx } from "react/jsx-runtime";
import { label } from "../../src/label.variants.js";
function Label({ className, ...rest }) {
  return /* @__PURE__ */ jsx("label", { ...rest, className: label({ class: className }) });
}
export {
  Label
};
