"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import Frame from "./VisualizationFrame.js";
import Mark from "./VisualizationMark.js";
import {
  ink,
  mutedInk,
  surface,
  seriesColor,
  tint,
  short
} from "../../src/visualization.js";
import {
  diagramLayout,
  diagramDimensions,
  diagramConnection
} from "../../src/diagram.js";
function Diagram(props) {
  const {
    data,
    direction = "right",
    label = "Diagram",
    description,
    width,
    height,
    size = "md",
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
  const scale = { sm: 0.875, md: 1, lg: 1.125 }[size];
  const dimensions = diagramDimensions(data, direction);
  const rows = [
    ...data.nodes.map((n) => ({
      ...n,
      value: n.description ?? n.kind ?? "process"
    })),
    ...data.edges.map((e) => ({ ...e, value: `${e.source} \u2192 ${e.target}` }))
  ];
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "Diagram",
      label,
      description,
      width,
      height,
      size,
      widthUnits: dimensions.widthUnits * scale,
      heightUnits: dimensions.heightUnits * scale,
      selected,
      detailHref,
      rows,
      onSelect: interactive ? select : void 0,
      className,
      children: ({ width: w, height: h, unit }) => {
        const u = unit * scale;
        const scene = diagramLayout(data, w, h, direction, u);
        return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            width: w,
            height: h,
            viewBox: `0 0 ${w} ${h}`,
            role: "group",
            "aria-label": label,
            children: [
              /* @__PURE__ */ jsx("title", { children: label }),
              scene.edges.map((e, index) => {
                const a = scene.nodes.find((n) => n.id === e.source);
                const b = scene.nodes.find((n) => n.id === e.target);
                const connection = diagramConnection(a, b, direction, u);
                const active = selected === e.id;
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  Mark,
                  {
                    id: e.id,
                    label: e.label,
                    selected,
                    onSelect: interactive ? select : void 0,
                    children: [
                      /* @__PURE__ */ jsx(
                        "path",
                        {
                          d: connection.path,
                          fill: "none",
                          stroke: active ? ink : mutedInk,
                          strokeWidth: active ? 2 : 1.25,
                          strokeDasharray: e.dashed ? "5 5" : void 0
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "path",
                        {
                          d: connection.arrow,
                          fill: "none",
                          stroke: active ? ink : mutedInk,
                          strokeWidth: active ? 2 : 1.25,
                          strokeLinejoin: "round"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: connection.labelX,
                          y: connection.labelY,
                          textAnchor: connection.labelAnchor,
                          fill: mutedInk,
                          className: "text-xs",
                          children: short(e.label, 20)
                        }
                      )
                    ]
                  }
                ) }, e.id);
              }),
              scene.nodes.map((n, index) => {
                const left = n.x - n.width / 2;
                const top = n.y - n.height / 2;
                const active = selected === n.id;
                const fill = n.series ? tint(seriesColor(n.series), active ? 16 : 8) : active ? tint(ink, 8) : surface;
                const stroke = active ? ink : n.series ? tint(seriesColor(n.series), 55) : tint(ink, 36);
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  Mark,
                  {
                    id: n.id,
                    label: `${n.label}${n.description ? ": " + n.description : ""}`,
                    selected,
                    onSelect: interactive ? select : void 0,
                    children: [
                      n.kind === "decision" ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "path",
                        {
                          d: `M${n.x},${top} L${left + n.width},${n.y} L${n.x},${top + n.height} L${left},${n.y} Z`,
                          fill,
                          stroke,
                          strokeWidth: active ? 2 : 1.25,
                          strokeLinejoin: "round"
                        }
                      ) }) : /* @__PURE__ */ jsx(Fragment, { children: n.kind === "store" ? /* @__PURE__ */ jsxs(Fragment, { children: [
                        /* @__PURE__ */ jsx(
                          "path",
                          {
                            d: `M${left},${top + u * 0.3} Q${left},${top} ${n.x},${top} Q${left + n.width},${top} ${left + n.width},${top + u * 0.3} V${top + n.height - u * 0.3} Q${left + n.width},${top + n.height} ${n.x},${top + n.height} Q${left},${top + n.height} ${left},${top + n.height - u * 0.3} Z`,
                            fill,
                            stroke,
                            strokeWidth: active ? 2 : 1.25
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "path",
                          {
                            d: `M${left},${top + u * 0.3} Q${left},${top + u * 0.6} ${n.x},${top + u * 0.6} Q${left + n.width},${top + u * 0.6} ${left + n.width},${top + u * 0.3}`,
                            fill: "none",
                            stroke
                          }
                        )
                      ] }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "rect",
                        {
                          x: left,
                          y: top,
                          width: n.width,
                          height: n.height,
                          rx: n.kind === "terminal" ? n.height / 2 : u / 4,
                          fill,
                          stroke,
                          strokeWidth: active ? 2 : 1.25
                        }
                      ) }) }),
                      /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: n.x,
                          y: n.y + (n.description ? -3 : 5),
                          textAnchor: "middle",
                          fill: ink,
                          className: "text-sm font-medium",
                          children: short(n.label, Math.floor((n.width - u) / 7.5))
                        }
                      ),
                      n.description ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: n.x,
                          y: n.y + 18,
                          textAnchor: "middle",
                          fill: mutedInk,
                          className: "text-xs",
                          children: short(
                            n.description,
                            Math.floor((n.width - u) / 6.5)
                          )
                        }
                      ) }) : null
                    ]
                  }
                ) }, n.id);
              })
            ]
          }
        ) });
      }
    }
  ) });
}
var Diagram_default = Diagram;
export {
  Diagram,
  Diagram_default as default
};
