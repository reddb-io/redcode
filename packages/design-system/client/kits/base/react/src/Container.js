import { jsx } from "react/jsx-runtime";
import { container } from "../../src/container.variants.js";
function Container({ size = "wide", className, ...rest }) {
  return /* @__PURE__ */ jsx("div", { ...rest, "data-container": true, "data-container-size": size, className: container({ size, class: className }) });
}
export {
  Container
};
