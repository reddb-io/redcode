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
  short
} from "../../src/visualization.js";
import Canvas from "./ChartCanvas.js";
import {
  radarData,
  radarPoint,
  radarFraction
} from "../../src/radar.js";
function Radar(props) {
  const {
    axes,
    data,
    label = "Radar",
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
  const series = radarData(axes, data);
  const rows = series.map((s) => ({
    ...s,
    value: axes.map((a) => `${a.label}: ${s.values[a.id] ?? "unavailable"}`).join(" \xB7 ")
  }));
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "Radar",
      label,
      description,
      width,
      height,
      size,
      selected,
      detailHref,
      rows,
      legend: series,
      onSelect: interactive ? select : void 0,
      className,
      children: ({ width: w, height: h }) => {
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.max(20, Math.min(w / 2 - 130, h / 2 - 40));
        return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(Canvas, { width: w, height: h, label, children: [
          [0.25, 0.5, 0.75, 1].map((fraction, index) => {
            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
              "polygon",
              {
                points: axes.map((_, i) => {
                  const p = radarPoint(
                    i,
                    axes.length,
                    fraction,
                    cx,
                    cy,
                    radius
                  );
                  return `${p.x},${p.y}`;
                }).join(" "),
                fill: "none",
                stroke: edge
              }
            ) }, index);
          }),
          axes.map((axis, i) => {
            const p = radarPoint(i, axes.length, 1, cx, cy, radius);
            const l = radarPoint(i, axes.length, 1.15, cx, cy, radius);
            return /* @__PURE__ */ jsxs(Fragment2, { children: [
              /* @__PURE__ */ jsx("line", { x1: cx, y1: cy, x2: p.x, y2: p.y, stroke: edge }),
              /* @__PURE__ */ jsx(
                "text",
                {
                  x: l.x,
                  y: l.y,
                  textAnchor: Math.abs(l.x - cx) < 1 ? "middle" : l.x > cx ? "start" : "end",
                  dominantBaseline: "middle",
                  fill: mutedInk,
                  className: "text-xs",
                  children: short(axis.label, 22)
                }
              )
            ] }, i);
          }),
          series.map((s, index) => {
            const complete = axes.every((a) => s.values[a.id] != null);
            const path = axes.map((a, i) => {
              const v = s.values[a.id];
              if (v == null) return "";
              const p = radarPoint(
                i,
                axes.length,
                radarFraction(v, a),
                cx,
                cy,
                radius
              );
              return `${i === 0 || s.values[axes[i - 1].id] == null ? "M" : "L"}${p.x},${p.y}`;
            }).join(" ") + (complete ? " Z" : "");
            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
              Mark,
              {
                id: s.id,
                label: rows.find((r) => r.id === s.id).value,
                selected,
                onSelect: interactive ? select : void 0,
                children: [
                  /* @__PURE__ */ jsx(
                    "path",
                    {
                      d: path,
                      fill: complete ? tint(seriesColor(s.series, s.color), 12) : "none",
                      fillOpacity: complete ? 0.5 : 0,
                      stroke: seriesColor(s.series, s.color),
                      strokeWidth: selected === s.id ? 3 : 1.5
                    }
                  ),
                  axes.map((a, i) => {
                    return /* @__PURE__ */ jsx(Fragment2, { children: s.values[a.id] != null ? (() => {
                      const p = radarPoint(
                        i,
                        axes.length,
                        radarFraction(s.values[a.id], a),
                        cx,
                        cy,
                        radius
                      );
                      return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "circle",
                        {
                          cx: p.x,
                          cy: p.y,
                          r: 3,
                          fill: seriesColor(s.series, s.color)
                        }
                      ) });
                    })() : null }, i);
                  })
                ]
              }
            ) }, s.id);
          })
        ] }) });
      }
    }
  ) });
}
var Radar_default = Radar;
export {
  Radar,
  Radar_default as default
};
