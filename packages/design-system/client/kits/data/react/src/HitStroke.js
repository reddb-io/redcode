"use client";
import { jsx } from "react/jsx-runtime";
function HitStroke({ d }) {
  return /* @__PURE__ */ jsx(
    "path",
    {
      d,
      "data-hit-stroke": "",
      fill: "none",
      stroke: "transparent",
      pointerEvents: "stroke",
      strokeLinecap: "round",
      vectorEffect: "non-scaling-stroke",
      style: { strokeWidth: "var(--reddb-spatial-target-min)" }
    }
  );
}
export {
  HitStroke as default
};
