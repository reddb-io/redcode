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
  number,
  short
} from "../../src/visualization.js";
import Canvas from "./ChartCanvas.js";
import SankeyLayout from "./SankeyLayout.js";
import { sankeyData } from "../../src/sankey.js";
function Sankey(props) {
  const {
    data,
    format = number,
    label = "Sankey",
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
  const flow = sankeyData(data);
  const rows = data.links.map((l) => ({
    ...l,
    value: format(l.value),
    description: `${data.nodes.find((n) => n.id === l.source)?.label} \u2192 ${data.nodes.find((n) => n.id === l.target)?.label}`
  }));
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "Sankey",
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
        return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
          Canvas,
          {
            width: w,
            height: h,
            label,
            data: flow,
            padding: { left: 100, right: 100, top: 24, bottom: 24 },
            children: flow.links.length ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
              SankeyLayout,
              {
                data: flow,
                width: w - 200,
                height: h - 48,
                nodeId: (node) => node.id,
                nodeWidth: 12,
                nodePadding: 24,
                children: ({ nodes, links }) => {
                  return /* @__PURE__ */ jsxs(Fragment, { children: [
                    links.map((link, index) => {
                      const x0 = link.source.x1;
                      const x1 = link.target.x0;
                      const mid = (x0 + x1) / 2;
                      return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                        Mark,
                        {
                          id: link.id,
                          label: `${link.label}: ${format(link.value)}`,
                          selected,
                          onSelect: interactive ? select : void 0,
                          children: /* @__PURE__ */ jsx(
                            "path",
                            {
                              d: `M${x0},${link.y0} C${mid},${link.y0} ${mid},${link.y1} ${x1},${link.y1}`,
                              fill: "none",
                              stroke: seriesColor(
                                link.series ?? link.source.series,
                                link.color ?? (link.series === void 0 ? link.source.color : void 0)
                              ),
                              strokeOpacity: selected === link.id ? 0.8 : 0.25,
                              strokeWidth: Math.max(1, link.width)
                            }
                          )
                        }
                      ) }, index);
                    }),
                    nodes.map((node, index) => {
                      return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                        Mark,
                        {
                          id: node.id,
                          label: `${node.label}: ${format(node.value)}`,
                          selected,
                          onSelect: interactive ? select : void 0,
                          children: [
                            /* @__PURE__ */ jsx(
                              "rect",
                              {
                                x: node.x0,
                                y: node.y0,
                                width: node.x1 - node.x0,
                                height: node.y1 - node.y0,
                                rx: 2,
                                fill: seriesColor(node.series, node.color)
                              }
                            ),
                            /* @__PURE__ */ jsx(
                              "text",
                              {
                                x: node.x0 < 1 ? node.x0 - 10 : node.x1 + 10,
                                y: (node.y0 + node.y1) / 2 - 3,
                                textAnchor: node.x0 < 1 ? "end" : "start",
                                fill: ink,
                                className: "text-xs",
                                children: short(node.label, 15)
                              }
                            ),
                            /* @__PURE__ */ jsx(
                              "text",
                              {
                                x: node.x0 < 1 ? node.x0 - 10 : node.x1 + 10,
                                y: (node.y0 + node.y1) / 2 + 13,
                                textAnchor: node.x0 < 1 ? "end" : "start",
                                fill: mutedInk,
                                className: "font-mono text-xs",
                                children: format(node.value)
                              }
                            )
                          ]
                        }
                      ) }, index);
                    })
                  ] });
                }
              }
            ) }) : null
          }
        ) });
      }
    }
  ) });
}
var Sankey_default = Sankey;
export {
  Sankey,
  Sankey_default as default
};
