"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import Frame from "./VisualizationFrame.js";
import Mark from "./VisualizationMark.js";
import {
  edge,
  ink,
  mutedInk,
  seriesColor,
  tint,
  number,
  short
} from "../../src/visualization.js";
import Canvas from "./ChartCanvas.js";
import { waterfallSteps } from "../../src/waterfall.js";
import { domain, project, ticks } from "../../src/visualization.js";
function Waterfall(props) {
  const {
    data,
    format = number,
    label = "Waterfall",
    description,
    width,
    height,
    size = "lg",
    selected: initialSelected = "",
    onSelectedChange,
    interactive = true,
    detailHref,
    className = ""
  } = props;
  const [selected, setSelected] = useControllableValue(
    props.selected,
    initialSelected,
    props.onSelectedChange
  );
  function select(id) {
    setSelected(id);
  }
  const steps = waterfallSteps(data);
  const yd = domain([0, ...steps.flatMap((s) => [s.start, s.end])]);
  const rows = steps.map((s) => ({
    ...s,
    value: format(s.amount),
    description: `${s.kind} \xB7 balance ${format(s.end)}`
  }));
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "Waterfall",
      label,
      description,
      width,
      height,
      size,
      selected,
      detailHref,
      rows,
      onSelect: interactive ? select : void 0,
      className,
      children: ({ width: w, height: h }) => {
        const left = Math.min(
          w * 0.2,
          Math.max(44, ...ticks(yd).map((v) => format(v).length * 7 + 12))
        );
        const bottom = h - 50;
        const band = (w - left - 12) / Math.max(1, steps.length);
        return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(Canvas, { width: w, height: h, label, children: [
          ticks(yd).map((tick, index) => {
            const y = project(tick, yd, bottom, 28);
            return /* @__PURE__ */ jsxs(Fragment2, { children: [
              /* @__PURE__ */ jsx("line", { x1: left, x2: w - 12, y1: y, y2: y, stroke: edge }),
              /* @__PURE__ */ jsx(
                "text",
                {
                  x: left - 8,
                  y,
                  textAnchor: "end",
                  dominantBaseline: "middle",
                  fill: mutedInk,
                  className: "font-mono text-xs",
                  children: format(tick)
                }
              )
            ] }, index);
          }),
          steps.map((step, i) => {
            const x = left + i * band + band * 0.13;
            const y1 = project(step.start, yd, bottom, 28);
            const y2 = project(step.end, yd, bottom, 28);
            return /* @__PURE__ */ jsxs(Fragment2, { children: [
              /* @__PURE__ */ jsxs(
                Mark,
                {
                  id: step.id,
                  label: `${step.label}: ${format(step.amount)}, balance ${format(step.end)}`,
                  selected,
                  onSelect: interactive ? select : void 0,
                  children: [
                    /* @__PURE__ */ jsx(
                      "rect",
                      {
                        x,
                        y: Math.min(y1, y2),
                        width: band * 0.74,
                        height: Math.max(1, Math.abs(y2 - y1)),
                        fill: step.kind !== "delta" ? tint(seriesColor(step.series, step.color), 30) : step.amount < 0 ? "var(--reddb-color-background)" : tint(seriesColor(step.series, step.color), 14),
                        stroke: selected === step.id ? ink : seriesColor(step.series, step.color),
                        strokeWidth: selected === step.id ? 2.5 : 1.5
                      }
                    ),
                    /* @__PURE__ */ jsxs(
                      "text",
                      {
                        x: x + band * 0.37,
                        y: Math.min(y1, y2) - 8,
                        textAnchor: "middle",
                        fill: ink,
                        className: "font-mono text-xs",
                        children: [
                          step.kind === "delta" && step.amount > 0 ? "+" : "",
                          format(step.amount)
                        ]
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "text",
                      {
                        x: x + band * 0.37,
                        y: bottom + 20,
                        textAnchor: "middle",
                        fill: mutedInk,
                        className: "text-xs",
                        children: short(step.label, Math.max(5, Math.floor(band / 7)))
                      }
                    )
                  ]
                }
              ),
              i < steps.length - 1 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                "line",
                {
                  x1: x + band * 0.74,
                  x2: x + band,
                  y1: y2,
                  y2,
                  stroke: mutedInk
                }
              ) }) : null
            ] }, i);
          })
        ] }) });
      }
    }
  ) });
}
var Waterfall_default = Waterfall;
export {
  Waterfall,
  Waterfall_default as default
};
