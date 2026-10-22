import { jsx, jsxs } from "react/jsx-runtime";
import { radialProgress } from "../../src/radial-progress.variants.js";
import { formatPercent, normalizeRange, isDeterminate } from "../../src/progress.behavior.js";
function RadialProgress({ value, min = 0, max = 100, label = "Progress", size = "md", formatValue, tone = "neutral", className, ...rest }) {
  const determinate = isDeterminate(value);
  const range = normalizeRange(isDeterminate(value) ? value : min, min, max);
  const valueText = determinate ? formatValue?.(range.value) ?? formatPercent(range) : "In progress";
  const slots = radialProgress({ tone, size, indeterminate: !determinate });
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ...rest,
      "data-radial-progress": true,
      "data-state": determinate ? "determinate" : "indeterminate",
      className: slots.root({ class: className }),
      role: "progressbar",
      "aria-label": label,
      "aria-valuemin": range.min,
      "aria-valuemax": range.max,
      "aria-valuenow": determinate ? range.value : void 0,
      "aria-valuetext": valueText,
      children: [
        /* @__PURE__ */ jsxs("svg", { className: slots.svg(), viewBox: "0 0 36 36", "aria-hidden": "true", children: [
          /* @__PURE__ */ jsx("circle", { className: slots.track(), cx: "18", cy: "18", r: "15.5", strokeWidth: "3" }),
          /* @__PURE__ */ jsx("circle", { className: slots.indicator(), cx: "18", cy: "18", r: "15.5", pathLength: "100", strokeWidth: "3", strokeLinecap: "round", strokeDasharray: determinate ? 100 : 25, strokeDashoffset: determinate ? 100 - range.percent : 0 })
        ] }),
        /* @__PURE__ */ jsx("span", { className: slots.value(), children: valueText })
      ]
    }
  );
}
export {
  RadialProgress
};
