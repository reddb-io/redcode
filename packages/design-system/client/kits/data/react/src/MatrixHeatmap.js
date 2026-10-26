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
import {
  matrixData
} from "../../src/matrix-heatmap.js";
import { domain, project } from "../../src/visualization.js";
function MatrixHeatmap(props) {
  const {
    rowAxis,
    columnAxis,
    data,
    valueDomain,
    format = number,
    label = "MatrixHeatmap",
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
  const cells = matrixData(rowAxis, columnAxis, data);
  const scale = domain(
    [0, ...cells.flatMap((c) => c.value === null ? [] : [c.value])],
    valueDomain
  );
  const rows = cells.map((c) => ({
    ...c,
    value: c.value === null ? "Unavailable" : format(c.value)
  }));
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "MatrixHeatmap",
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
          w * 0.24,
          Math.max(64, ...rowAxis.map((r) => r.label.length * 7 + 12))
        );
        const cw = (w - left - 8) / Math.max(1, columnAxis.length);
        const ch = (h - 54) / Math.max(1, rowAxis.length);
        return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(Canvas, { width: w, height: h, label, children: [
          columnAxis.map((column, i) => {
            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
              "text",
              {
                x: left + (i + 0.5) * cw,
                y: 18,
                textAnchor: "middle",
                fill: mutedInk,
                className: "font-mono text-xs",
                children: short(column.label, Math.max(4, Math.floor(cw / 7)))
              }
            ) }, i);
          }),
          rowAxis.map((row, i) => {
            return /* @__PURE__ */ jsxs(Fragment2, { children: [
              /* @__PURE__ */ jsx(
                "text",
                {
                  x: left - 12,
                  y: 32 + (i + 0.5) * ch,
                  textAnchor: "end",
                  dominantBaseline: "middle",
                  fill: mutedInk,
                  className: "font-mono text-xs",
                  children: short(row.label, 24)
                }
              ),
              columnAxis.map((column, j) => {
                const cell = cells.find(
                  (c) => c.row === row.id && c.column === column.id
                );
                const intensity = cell?.value == null ? 0 : Math.max(
                  0,
                  Math.min(1, project(cell.value, scale, 0, 1))
                );
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  Mark,
                  {
                    id: cell?.id ?? JSON.stringify([row.id, column.id]),
                    label: `${row.label} / ${column.label}: ${cell?.value == null ? "Unavailable" : format(cell.value)}`,
                    selected,
                    onSelect: interactive && cell ? select : void 0,
                    children: [
                      /* @__PURE__ */ jsx(
                        "rect",
                        {
                          x: left + j * cw + 2,
                          y: 32 + i * ch + 2,
                          width: Math.max(0, cw - 4),
                          height: Math.max(0, ch - 4),
                          fill: cell?.value == null ? "none" : tint(
                            seriesColor(cell.series),
                            8 + intensity * 48
                          ),
                          stroke: selected === cell?.id ? ink : edge,
                          strokeDasharray: cell?.value == null ? "3 3" : void 0
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: left + (j + 0.5) * cw,
                          y: 32 + (i + 0.5) * ch,
                          textAnchor: "middle",
                          dominantBaseline: "middle",
                          fill: ink,
                          className: "font-mono text-xs",
                          children: cell?.value == null ? "\u2014" : format(cell.value)
                        }
                      )
                    ]
                  }
                ) }, j);
              })
            ] }, i);
          }),
          /* @__PURE__ */ jsxs("text", { x: left, y: h - 4, fill: mutedInk, className: "text-xs", children: [
            format(scale[0]),
            " \u2192 ",
            format(scale[1]),
            " \xB7 intensity"
          ] })
        ] }) });
      }
    }
  ) });
}
var MatrixHeatmap_default = MatrixHeatmap;
export {
  MatrixHeatmap,
  MatrixHeatmap_default as default
};
