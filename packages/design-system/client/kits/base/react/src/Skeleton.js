import { jsx } from "react/jsx-runtime";
import { skeleton } from "../../src/skeleton.variants.js";
import { skeletonGeometry, skeletonSvgMarkup } from "../../src/core/skeleton.js";
function Skeleton({ shape = "text", label, rows = 5, columns = 4, animated = true, style, className, ...rest }) {
  const geometry = skeletonGeometry(shape, rows, columns);
  return /* @__PURE__ */ jsx(
    "div",
    {
      ...rest,
      "data-skeleton": true,
      "data-shape": shape,
      className: skeleton({ shape, animated, class: className }),
      style: { gridTemplateRows: geometry?.tracks, ...style },
      role: label ? "status" : void 0,
      "aria-label": label,
      "aria-live": label ? "polite" : void 0,
      "aria-busy": label ? "true" : void 0,
      "aria-hidden": label ? void 0 : "true",
      children: geometry && /* @__PURE__ */ jsx("svg", { "data-skeleton-svg": true, viewBox: `0 0 ${geometry.width} ${geometry.height}`, preserveAspectRatio: shape === "pie" || shape === "donut" || shape === "radial" ? "xMidYMid meet" : "none", "aria-hidden": "true", focusable: "false", className: "absolute inset-0 block h-full w-full", dangerouslySetInnerHTML: { __html: skeletonSvgMarkup(geometry) } })
    }
  );
}
export {
  Skeleton
};
