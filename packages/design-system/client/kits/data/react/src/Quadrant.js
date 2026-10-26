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
  number,
  short
} from "../../src/visualization.js";
import Canvas from "./ChartCanvas.js";
import { scatterData } from "../../src/scatter.js";
import { domain, project } from "../../src/visualization.js";
function Quadrant(props) {
  const {
    data,
    xDomain = [0, 100],
    yDomain = [0, 100],
    thresholds,
    regions = ["High / Low", "High / High", "Low / Low", "Low / High"],
    xLabel = "",
    yLabel = "",
    label = "Quadrant",
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
  const points = scatterData(data);
  const xd = domain([], xDomain), yd = domain([], yDomain);
  const split = thresholds ?? [(xd[0] + xd[1]) / 2, (yd[0] + yd[1]) / 2];
  const rows = points.map((p) => ({
    ...p,
    value: `${number(p.x)} / ${number(p.y)}`
  }));
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "Quadrant",
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
        const left = 24;
        const right = w - 24;
        const top = 34;
        const bottom = h - 36;
        const sx = project(split[0], xd, left, right);
        const sy = project(split[1], yd, bottom, top);
        return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(Canvas, { width: w, height: h, label, children: [
          /* @__PURE__ */ jsx("line", { x1: sx, x2: sx, y1: top, y2: bottom, stroke: edge }),
          /* @__PURE__ */ jsx("line", { x1: left, x2: right, y1: sy, y2: sy, stroke: edge }),
          regions.map((region, i) => {
            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
              "text",
              {
                x: i % 2 === 0 ? left + 8 : right - 8,
                y: i < 2 ? top + 12 : bottom - 10,
                textAnchor: i % 2 === 0 ? "start" : "end",
                fill: mutedInk,
                className: "font-mono text-xs",
                children: region
              }
            ) }, i);
          }),
          /* @__PURE__ */ jsx("text", { x: left, y: 16, fill: mutedInk, className: "text-xs", children: yLabel }),
          /* @__PURE__ */ jsx(
            "text",
            {
              x: right,
              y: h - 8,
              textAnchor: "end",
              fill: mutedInk,
              className: "text-xs",
              children: xLabel
            }
          ),
          points.map((p, index) => {
            const x = project(p.x, xd, left, right);
            const y = project(p.y, yd, bottom, top);
            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
              Mark,
              {
                id: p.id,
                label: `${p.label}: ${number(p.x)} / ${number(p.y)}`,
                selected,
                onSelect: interactive ? select : void 0,
                children: [
                  /* @__PURE__ */ jsx(
                    "circle",
                    {
                      cx: x,
                      cy: y,
                      r: selected === p.id ? 6 : 4,
                      fill: seriesColor(p.series)
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "text",
                    {
                      x: x > w * 0.7 ? x - 12 : x + 12,
                      y,
                      textAnchor: x > w * 0.7 ? "end" : "start",
                      dominantBaseline: "middle",
                      fill: selected === p.id ? ink : mutedInk,
                      className: "text-xs",
                      children: short(p.label, 24)
                    }
                  )
                ]
              }
            ) }, p.id);
          })
        ] }) });
      }
    }
  ) });
}
var Quadrant_default = Quadrant;
export {
  Quadrant,
  Quadrant_default as default
};
