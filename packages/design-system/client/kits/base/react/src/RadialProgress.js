import { jsx, jsxs } from "react/jsx-runtime";
import { ringThickness } from "../../src/core/radial.js";
import { tokenColor } from "../../src/core/color-token.js";
import { radialProgress } from "../../src/radial-progress.variants.js";
import { formatPercent, normalizeRange, isDeterminate } from "../../src/progress.behavior.js";
function RadialProgress({ value, min = 0, max = 100, label = "Progress", size = "md", formatValue, tone = "neutral", thickness = 3 / 17, color, diameter, center, style, className, ...rest }) {
  const stroke = ringThickness(thickness) * 17;
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
      style: { ...style, width: diameter ?? style?.width, height: diameter ?? style?.height },
      role: "progressbar",
      "aria-label": label,
      "aria-valuemin": range.min,
      "aria-valuemax": range.max,
      "aria-valuenow": determinate ? range.value : void 0,
      "aria-valuetext": valueText,
      children: [
        /* @__PURE__ */ jsxs("svg", { className: slots.svg(), viewBox: "0 0 36 36", "aria-hidden": "true", children: [
          /* @__PURE__ */ jsx("circle", { className: slots.track(), cx: "18", cy: "18", r: 17 - stroke / 2, strokeWidth: stroke }),
          /* @__PURE__ */ jsx("circle", { style: { stroke: color ? tokenColor(color, "currentColor") : void 0 }, className: slots.indicator(), cx: "18", cy: "18", r: 17 - stroke / 2, pathLength: "100", strokeWidth: stroke, strokeLinecap: "round", strokeDasharray: determinate ? 100 : 25, strokeDashoffset: determinate ? 100 - range.percent : 0 })
        ] }),
        center ? /* @__PURE__ */ jsx("div", { "data-radial-center": true, className: "absolute grid place-items-center overflow-hidden", style: { width: `${(1 - thickness) * 94}%`, height: `${(1 - thickness) * 94}%` }, children: center({ value: range.value, percent: range.percent, determinate }) }) : /* @__PURE__ */ jsx("span", { className: slots.value(), children: valueText })
      ]
    }
  );
}
export {
  RadialProgress
};
