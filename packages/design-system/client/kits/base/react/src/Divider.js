import { jsx } from "react/jsx-runtime";
import { divider } from "../../src/divider.variants.js";
function Divider({ orientation = "horizontal", className, ...rest }) {
  return /* @__PURE__ */ jsx("div", { ...rest, "data-divider": true, role: "separator", "aria-orientation": orientation, className: divider({ orientation, class: className }) });
}
export {
  Divider
};
