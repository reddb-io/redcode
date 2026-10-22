import { jsx, jsxs } from "react/jsx-runtime";
import { segmentGeometry } from "../../src/core/segments.js";
import { segments as segmentStyles } from "../../src/segments.variants.js";
import { meter } from "../../src/meter.variants.js";
import { formatPercent, normalizeRange } from "../../src/progress.behavior.js";
function Meter({
  value,
  min = 0,
  max = 100,
  label = "Meter",
  layout = "stacked",
  labelHidden = false,
  formatValue,
  tone = "neutral",
  segments,
  segmentColumns,
  className,
  ...rest
}) {
  const range = normalizeRange(value, min, max);
  const valueText = formatValue?.(range.value) ?? formatPercent(range);
  const slots = meter({ tone, layout, labelHidden });
  const discrete = segments === void 0 ? void 0 : segmentGeometry(segments, range.percent, segmentColumns);
  const discreteSlots = segmentStyles();
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ...rest,
      "data-meter": true,
      "data-tone": tone,
      className: slots.root({ class: className }),
      role: "meter",
      "aria-label": label,
      "aria-valuemin": range.min,
      "aria-valuemax": range.max,
      "aria-valuenow": range.value,
      "aria-valuetext": valueText,
      children: [
        /* @__PURE__ */ jsxs("div", { "data-meter-summary": true, className: slots.summary(), "aria-hidden": "true", children: [
          /* @__PURE__ */ jsx("span", { className: slots.label(), children: label }),
          /* @__PURE__ */ jsx("span", { className: slots.value(), children: valueText })
        ] }),
        discrete ? /* @__PURE__ */ jsx(
          "div",
          {
            "data-meter-track": true,
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
        ) : /* @__PURE__ */ jsx("div", { "data-meter-track": true, className: slots.track(), "aria-hidden": "true", children: /* @__PURE__ */ jsx(
          "div",
          {
            "data-meter-indicator": true,
            className: slots.indicator(),
            style: { width: `${range.percent}%` }
          }
        ) })
      ]
    }
  );
}
export {
  Meter
};
