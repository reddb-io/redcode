import { jsx } from "react/jsx-runtime";
import { stack } from "../../src/stack.variants.js";
function Stack({ gap = "layout-md", direction = "column", align = "stretch", justify = "start", wrap = false, className, ...rest }) {
  return /* @__PURE__ */ jsx("div", { ...rest, "data-stack": true, "data-stack-direction": direction, className: stack({ gap, direction, align, justify, wrap, class: className }) });
}
export {
  Stack
};
