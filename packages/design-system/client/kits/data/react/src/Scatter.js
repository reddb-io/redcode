"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import Frame from "./VisualizationFrame.js";
import Mark from "./VisualizationMark.js";
import {
  edge,
  mutedInk,
  seriesColor,
  tint,
  number
} from "../../src/visualization.js";
import Canvas from "./ChartCanvas.js";
import { scatterData, regression } from "../../src/scatter.js";
import { domain, project, ticks } from "../../src/visualization.js";
function Scatter(props) {
  const {
    data,
    xDomain,
    yDomain,
    xLabel = "",
    yLabel = "",
    trend = false,
    formatX = number,
    formatY = number,
    label = "Scatter",
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
  const xd = domain(
    points.map((p) => p.x),
    xDomain
  );
  const yd = domain(
    points.map((p) => p.y),
    yDomain
  );
  const line = trend ? regression(points) : void 0;
  const rows = points.map((p) => ({
    ...p,
    value: `${formatX(p.x)} / ${formatY(p.y)}`
  }));
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "Scatter",
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
          Math.max(44, ...ticks(yd).map((v) => formatY(v).length * 7 + 12))
        );
        return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(Canvas, { width: w, height: h, label, children: [
          ticks(yd).map((tick, index) => {
            const y = project(tick, yd, h - 44, 28);
            return /* @__PURE__ */ jsxs(Fragment2, { children: [
              /* @__PURE__ */ jsx("line", { x1: left, x2: w - 20, y1: y, y2: y, stroke: edge }),
              /* @__PURE__ */ jsx(
                "text",
                {
                  x: left - 8,
                  y,
                  textAnchor: "end",
                  dominantBaseline: "middle",
                  fill: mutedInk,
                  className: "font-mono text-xs",
                  children: formatY(tick)
                }
              )
            ] }, index);
          }),
          ticks(xd).map((tick, index) => {
            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
              "text",
              {
                x: project(tick, xd, left, w - 20),
                y: h - 24,
                textAnchor: "middle",
                fill: mutedInk,
                className: "font-mono text-xs",
                children: formatX(tick)
              }
            ) }, index);
          }),
          /* @__PURE__ */ jsx("text", { x: left, y: 16, fill: mutedInk, className: "text-xs", children: yLabel }),
          /* @__PURE__ */ jsx(
            "text",
            {
              x: w - 20,
              y: h - 5,
              textAnchor: "end",
              fill: mutedInk,
              className: "text-xs",
              children: xLabel
            }
          ),
          line ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
            "line",
            {
              x1: project(line[0].x, xd, left, w - 20),
              y1: project(line[0].y, yd, h - 44, 28),
              x2: project(line[1].x, xd, left, w - 20),
              y2: project(line[1].y, yd, h - 44, 28),
              stroke: mutedInk,
              strokeDasharray: "5 5"
            }
          ) }) : null,
          points.map((p, index) => {
            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
              Mark,
              {
                id: p.id,
                label: `${p.label}: ${formatX(p.x)}, ${formatY(p.y)}`,
                selected,
                onSelect: interactive ? select : void 0,
                children: /* @__PURE__ */ jsx(
                  "circle",
                  {
                    cx: project(p.x, xd, left, w - 20),
                    cy: project(p.y, yd, h - 44, 28),
                    r: p.radius ?? 5,
                    fill: tint(
                      seriesColor(p.series),
                      selected === p.id ? 55 : 20
                    ),
                    stroke: seriesColor(p.series),
                    strokeWidth: selected === p.id ? 3 : 1.5
                  }
                )
              }
            ) }, p.id);
          })
        ] }) });
      }
    }
  ) });
}
var Scatter_default = Scatter;
export {
  Scatter,
  Scatter_default as default
};
