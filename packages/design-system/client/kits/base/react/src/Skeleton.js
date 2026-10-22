import { jsx } from "react/jsx-runtime";
import { skeleton } from "../../src/skeleton.variants.js";
function Skeleton({ shape = "text", label, className, ...rest }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      ...rest,
      "data-skeleton": true,
      "data-shape": shape,
      className: skeleton({ shape, class: className }),
      role: label ? "status" : void 0,
      "aria-label": label,
      "aria-live": label ? "polite" : void 0,
      "aria-busy": label ? "true" : void 0,
      "aria-hidden": label ? void 0 : "true"
    }
  );
}
export {
  Skeleton
};
