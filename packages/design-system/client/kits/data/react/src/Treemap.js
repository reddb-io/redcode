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
import TreemapLayout from "./TreemapLayout.js";
import { hierarchy } from "d3-hierarchy";
import { treemapNodes } from "../../src/treemap.js";
function Treemap(props) {
  const {
    data,
    format = number,
    rootId,
    label = "Treemap",
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
  const all = treemapNodes(data);
  const root = all.find((n) => n.id === rootId) ?? data;
  const tree = hierarchy(root, (d) => d.children).sum((d) => d.children?.length ? 0 : d.value ?? 0).sort(
    (a, b) => (b.value ?? 0) - (a.value ?? 0) || a.data.id.localeCompare(b.data.id)
  );
  const rows = tree.descendants().map((n) => ({ ...n.data, value: format(n.value ?? 0) }));
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "Treemap",
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
        return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(Canvas, { width: w, height: h, label, children: (tree.value ?? 0) > 0 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
          TreemapLayout,
          {
            width: w,
            height: h,
            hierarchy: tree,
            paddingInner: 4,
            paddingTop: (node) => node.depth === 0 ? 0 : node.children ? 28 : 4,
            children: ({ nodes }) => {
              return /* @__PURE__ */ jsx(Fragment, { children: nodes.filter((n) => n.depth > 0 || !n.children).map((node, index) => {
                const nw = node.x1 - node.x0;
                const nh = node.y1 - node.y0;
                const color = seriesColor(node.data.series);
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  Mark,
                  {
                    id: node.data.id,
                    label: `${node.data.label}: ${format(node.value ?? 0)}`,
                    selected,
                    onSelect: interactive ? select : void 0,
                    children: [
                      /* @__PURE__ */ jsx(
                        "rect",
                        {
                          x: node.x0,
                          y: node.y0,
                          width: nw,
                          height: nh,
                          fill: node.children ? "none" : tint(
                            color,
                            selected === node.data.id ? 36 : 14
                          ),
                          stroke: selected === node.data.id ? ink : edge,
                          strokeWidth: selected === node.data.id ? 2 : 1
                        }
                      ),
                      nw > 65 && nh > 25 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: node.x0 + 8,
                          y: node.y0 + 18,
                          fill: ink,
                          className: "text-xs",
                          children: short(
                            node.data.label,
                            Math.floor((nw - 16) / 7)
                          )
                        }
                      ) }) : null,
                      !node.children && nw > 80 && nh > 55 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: node.x0 + 8,
                          y: node.y0 + 38,
                          fill: mutedInk,
                          className: "font-mono text-xs",
                          children: format(node.value ?? 0)
                        }
                      ) }) : null
                    ]
                  }
                ) }, node.data.id);
              }) });
            }
          }
        ) }) : null }) });
      }
    }
  ) });
}
var Treemap_default = Treemap;
export {
  Treemap,
  Treemap_default as default
};
