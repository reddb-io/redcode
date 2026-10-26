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
  surface,
  seriesColor,
  short
} from "../../src/visualization.js";
import { sequenceData } from "../../src/sequence-diagram.js";
function SequenceDiagram(props) {
  const {
    data,
    label = "SequenceDiagram",
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
  const sequence = sequenceData(data);
  const rows = sequence.messages.map((m) => ({
    ...m,
    value: `${m.source} \u2192 ${m.target}`,
    description: m.kind ?? "call"
  }));
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Frame,
    {
      kind: "SequenceDiagram",
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
        const band = w / Math.max(1, sequence.participants.length);
        const step = (h - 90) / Math.max(1, sequence.messages.length);
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
              sequence.participants.map((p, i) => {
                const x = (i + 0.5) * band;
                return /* @__PURE__ */ jsxs(Fragment2, { children: [
                  /* @__PURE__ */ jsx(
                    "rect",
                    {
                      x: x - band * 0.4,
                      y: 8,
                      width: band * 0.8,
                      height: 34,
                      rx: 4,
                      fill: surface,
                      stroke: edge
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "text",
                    {
                      x,
                      y: 30,
                      textAnchor: "middle",
                      fill: ink,
                      className: "text-xs font-medium",
                      children: short(p.label, Math.floor(band / 8))
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "line",
                    {
                      x1: x,
                      x2: x,
                      y1: 42,
                      y2: h - 8,
                      stroke: edge,
                      strokeDasharray: "4 4"
                    }
                  )
                ] }, i);
              }),
              sequence.messages.map((m, i) => {
                const sx = (sequence.participants.findIndex((p) => p.id === m.source) + 0.5) * band;
                const tx = (sequence.participants.findIndex((p) => p.id === m.target) + 0.5) * band;
                const y = 76 + i * step;
                const sign = tx >= sx ? 1 : -1;
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  Mark,
                  {
                    id: m.id,
                    label: `${m.label}: ${m.source} \u2192 ${m.target}`,
                    selected,
                    onSelect: interactive ? select : void 0,
                    children: [
                      sx === tx ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "path",
                        {
                          d: `M${sx},${y} h32 v16 h-32`,
                          fill: "none",
                          stroke: seriesColor(m.series, m.color)
                        }
                      ) }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                        "line",
                        {
                          x1: sx,
                          x2: tx,
                          y1: y,
                          y2: y,
                          stroke: seriesColor(m.series, m.color),
                          strokeWidth: selected === m.id ? 2.5 : 1.5,
                          strokeDasharray: m.kind === "return" ? "5 4" : void 0
                        }
                      ) }),
                      /* @__PURE__ */ jsx(
                        "path",
                        {
                          d: `M${tx - sign * 7},${y - 4} L${tx},${y} L${tx - sign * 7},${y + 4}`,
                          fill: m.kind === "async" ? "none" : seriesColor(m.series, m.color),
                          stroke: seriesColor(m.series, m.color)
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: (sx + tx) / 2 + (sx === tx ? 38 : 0),
                          y: y - 9,
                          textAnchor: sx === tx ? "start" : "middle",
                          fill: selected === m.id ? ink : mutedInk,
                          className: "text-xs",
                          children: short(
                            m.label,
                            Math.max(12, Math.floor(Math.abs(tx - sx) / 7))
                          )
                        }
                      )
                    ]
                  }
                ) }, m.id);
              })
            ]
          }
        ) });
      }
    }
  ) });
}
var SequenceDiagram_default = SequenceDiagram;
export {
  SequenceDiagram,
  SequenceDiagram_default as default
};
