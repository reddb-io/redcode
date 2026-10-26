"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Fragment as Fragment2 } from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import Frame from "./VisualizationFrame.js";
import Mark from "./VisualizationMark.js";
import {
  ink,
  mutedInk,
  seriesColor,
  tint
} from "../../src/visualization.js";
import {
  explodedLayers,
  explodedLayout,
  layerLines
} from "../../src/exploded-layers.js";
function ExplodedLayers(props) {
  const {
    data,
    label = "ExplodedLayers",
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
  const layers = explodedLayers(data);
  const rows = layers.map((l) => ({ ...l, value: l.description ?? "" }));
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "ExplodedLayers",
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
      children: ({ width: w, height: h, unit }) => {
        const scene = explodedLayout(layers, w, h, unit);
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
              scene.length > 1 ? (() => {
                const first = scene[0];
                const last = scene[scene.length - 1];
                return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
                  "g",
                  {
                    "aria-hidden": "true",
                    stroke: tint(ink, 18),
                    strokeDasharray: "4 5",
                    children: [
                      /* @__PURE__ */ jsx(
                        "line",
                        {
                          x1: first.left,
                          x2: last.left,
                          y1: first.cy,
                          y2: last.cy
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "line",
                        {
                          x1: first.right,
                          x2: last.right,
                          y1: first.cy,
                          y2: last.cy
                        }
                      )
                    ]
                  }
                ) });
              })() : null,
              [...scene].reverse().map((layer, index) => {
                const color = seriesColor(layer.series, layer.color);
                const active = selected === layer.id;
                const titleLines = layerLines(
                  layer.label,
                  Math.max(8, Math.floor((layer.labelWidth - 28) / 7.5))
                );
                const descriptionLines = layerLines(
                  layer.description ?? "",
                  Math.max(10, Math.floor((layer.labelWidth - 28) / 6.5))
                );
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  Mark,
                  {
                    id: layer.id,
                    label: `${layer.label}: ${layer.description ?? ""}`,
                    selected,
                    onSelect: interactive ? select : void 0,
                    children: [
                      /* @__PURE__ */ jsx(
                        "path",
                        {
                          "data-layer-face": "left",
                          d: layer.leftFace,
                          fill: tint(color, active ? 30 : 26)
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "path",
                        {
                          "data-layer-face": "right",
                          d: layer.rightFace,
                          fill: tint(color, active ? 40 : 36)
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "path",
                        {
                          "data-layer-face": "front",
                          d: layer.front,
                          fill: "none",
                          stroke: tint(color, 55),
                          strokeLinejoin: "round"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "path",
                        {
                          "data-layer-face": "top",
                          d: layer.top,
                          fill: tint(color, active ? 14 : 6),
                          stroke: active ? ink : tint(color, 55),
                          strokeWidth: active ? 2 : 1.25
                        }
                      ),
                      /* @__PURE__ */ jsxs("g", { "data-layer-callout": true, children: [
                        /* @__PURE__ */ jsx(
                          "line",
                          {
                            x1: layer.right + 8,
                            x2: layer.labelX - 16,
                            y1: layer.cy + layer.thickness / 2,
                            y2: layer.cy + layer.thickness / 2,
                            stroke: tint(ink, 24)
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "circle",
                          {
                            cx: layer.right,
                            cy: layer.cy + layer.thickness / 2,
                            r: 2.5,
                            fill: mutedInk
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "text",
                          {
                            "aria-hidden": "true",
                            x: layer.labelX,
                            y: layer.cy - 2,
                            fill: mutedInk,
                            className: "font-mono text-xs",
                            children: String(layer.index + 1).padStart(2, "0")
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "text",
                          {
                            x: layer.labelX + 28,
                            y: layer.cy - 2,
                            fill: ink,
                            className: "text-sm font-medium",
                            children: titleLines.map((line, index2) => {
                              return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                                "tspan",
                                {
                                  x: layer.labelX + 28,
                                  dy: index2 ? 18 : 0,
                                  children: line
                                }
                              ) }, index2);
                            })
                          }
                        ),
                        descriptionLines.length ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                          "text",
                          {
                            x: layer.labelX + 28,
                            y: layer.cy + 20 + (titleLines.length - 1) * 18,
                            fill: mutedInk,
                            className: "text-xs",
                            children: descriptionLines.map((line, index2) => {
                              return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                                "tspan",
                                {
                                  x: layer.labelX + 28,
                                  dy: index2 ? 17 : 0,
                                  children: line
                                }
                              ) }, index2);
                            })
                          }
                        ) }) : null
                      ] })
                    ]
                  }
                ) }, layer.id);
              })
            ]
          }
        ) });
      }
    }
  ) });
}
var ExplodedLayers_default = ExplodedLayers;
export {
  ExplodedLayers,
  ExplodedLayers_default as default
};
