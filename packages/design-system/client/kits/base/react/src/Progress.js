import { jsx, jsxs } from "react/jsx-runtime";
import { segmentGeometry } from "../../src/core/segments.js";
import { segments as segmentStyles } from "../../src/segments.variants.js";
import { progress } from "../../src/progress.variants.js";
import {
  formatPercent,
  normalizeRange,
  isDeterminate
} from "../../src/progress.behavior.js";
function Progress({
  value,
  min = 0,
  max = 100,
  label = "Progress",
  summary = false,
  formatValue,
  tone = "neutral",
  segments,
  segmentColumns,
  className,
  ...rest
}) {
  const determinate = isDeterminate(value);
  const range = normalizeRange(isDeterminate(value) ? value : min, min, max);
  const valueText = determinate ? formatValue?.(range.value) ?? formatPercent(range) : "In progress";
  const slots = progress({ tone, indeterminate: !determinate });
  const discrete = segments === void 0 ? void 0 : segmentGeometry(segments, range.percent, segmentColumns);
  const discreteSlots = segmentStyles();
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ...rest,
      "data-progress": true,
      "data-state": determinate ? "determinate" : "indeterminate",
      className: slots.root({ class: className }),
      role: "progressbar",
      "aria-label": label,
      "aria-valuemin": range.min,
      "aria-valuemax": range.max,
      "aria-valuenow": determinate ? range.value : void 0,
      "aria-valuetext": valueText,
      children: [
        summary && /* @__PURE__ */ jsxs(
          "div",
          {
            "data-progress-summary": true,
            className: slots.summary(),
            "aria-hidden": "true",
            children: [
              /* @__PURE__ */ jsx("span", { className: slots.label(), children: label }),
              /* @__PURE__ */ jsx("span", { className: slots.value(), children: valueText })
            ]
          }
        ),
        discrete && determinate ? /* @__PURE__ */ jsx(
          "div",
          {
            "data-progress-track": true,
            "data-segmented": true,
            "data-aggregated": discrete.aggregated || void 0,
            className: discreteSlots.track(),
            style: {
              gridTemplateColumns: `repeat(${discrete.columns}, minmax(0, 1fr))`
            },
            "aria-hidden": "true",
            children: discrete.fills.map((fill, i) => /* @__PURE__ */ jsx("div", { className: discreteSlots.cell(), children: /* @__PURE__ */ jsx(
              "div",
              {
                "data-segment-fill": true,
                className: slots.indicator({ class: discreteSlots.fill() }),
                style: { width: `${fill}%` }
              }
            ) }, i))
          }
        ) : /* @__PURE__ */ jsx("div", { "data-progress-track": true, className: slots.track(), "aria-hidden": "true", children: /* @__PURE__ */ jsx(
          "div",
          {
            "data-progress-indicator": true,
            className: slots.indicator(),
            style: { width: determinate ? `${range.percent}%` : void 0 }
          }
        ) })
      ]
    }
  );
}
export {
  Progress
};
