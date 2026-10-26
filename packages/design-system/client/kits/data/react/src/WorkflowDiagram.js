"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { operationalView } from "../../src/operational.variants.js";
import { useEffect, useRef, useState } from "react";
import { observeActivity } from "@reddb-io/design-system/base";
import { SceneViewport } from "./SceneViewport.js";
import Mark from "./VisualizationMark.js";
import { operationalToneInk } from "../../src/operational.js";
import {
  workflowLayout,
  workflowFocus,
  workflowNodeLabel
} from "../../src/workflow.js";
import {
  ink,
  mutedInk,
  surface,
  edge,
  seriesColor,
  short
} from "../../src/visualization.js";
import { useChartRhythm } from "./chart-state.js";
function WorkflowDiagram({
  label,
  data,
  direction = "right",
  selected = null,
  focused = null,
  interactive = false,
  playing = false,
  size = "md",
  onselectedchange,
  className
}) {
  const visual = operationalView();
  const host = useRef(null), probe = useRef(null), [allowed, setAllowed] = useState(false), rhythm = useChartRhythm(probe), scene = workflowLayout(data, direction, rhythm.row), focus = workflowFocus(scene, focused);
  useEffect(() => {
    if (host.current) return observeActivity(host.current, setAllowed);
  }, []);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: host,
      "data-workflow-diagram": true,
      className: visual.scene({ class: className }),
      children: [
        /* @__PURE__ */ jsx("span", { ref: probe, "aria-hidden": "true", className: visual.probe() }),
        /* @__PURE__ */ jsx("p", { className: visual.caption(), children: label }),
        /* @__PURE__ */ jsx(
          SceneViewport,
          {
            label,
            contentWidth: scene.width,
            contentHeight: scene.height,
            focus,
            size,
            children: /* @__PURE__ */ jsxs(
              "svg",
              {
                width: scene.width,
                height: scene.height,
                role: "group",
                "aria-label": label,
                children: [
                  /* @__PURE__ */ jsx("title", { children: label }),
                  scene.edges.map((channel) => /* @__PURE__ */ jsxs(
                    Mark,
                    {
                      id: channel.id,
                      label: `${channel.label}: ${channel.source} \u2192 ${channel.target}`,
                      selected: selected ?? void 0,
                      onSelect: interactive ? onselectedchange : void 0,
                      children: [
                        /* @__PURE__ */ jsx(
                          "path",
                          {
                            d: channel.path,
                            fill: "none",
                            stroke: selected === channel.id ? ink : mutedInk,
                            strokeWidth: selected === channel.id ? 2 : 1.25
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "path",
                          {
                            d: channel.arrow,
                            fill: "none",
                            stroke: selected === channel.id ? ink : mutedInk
                          }
                        ),
                        channel.bus && /* @__PURE__ */ jsx(
                          "text",
                          {
                            x: channel.labelX,
                            y: channel.labelY,
                            textAnchor: "middle",
                            fill: mutedInk,
                            className: visual.nodeText(),
                            children: channel.channel === 0 ? short(channel.bus, 9) : ""
                          }
                        ),
                        channel.active && playing && allowed && /* @__PURE__ */ jsxs("g", { "aria-hidden": "true", children: [
                          /* @__PURE__ */ jsx(
                            "animateMotion",
                            {
                              dur: "2s",
                              repeatCount: "indefinite",
                              path: channel.path
                            }
                          ),
                          /* @__PURE__ */ jsx("circle", { r: "3", fill: seriesColor(1) }),
                          channel.packetLabel && /* @__PURE__ */ jsx("text", { y: "-8", fill: ink, className: visual.nodeText(), children: short(channel.packetLabel, 12) })
                        ] })
                      ]
                    },
                    channel.id
                  )),
                  scene.nodes.map((node) => /* @__PURE__ */ jsxs(
                    Mark,
                    {
                      id: node.id,
                      label: workflowNodeLabel(node),
                      selected: selected ?? void 0,
                      onSelect: interactive ? onselectedchange : void 0,
                      children: [
                        /* @__PURE__ */ jsx(
                          "rect",
                          {
                            x: node.x,
                            y: node.y,
                            width: node.width,
                            height: node.height,
                            rx: node.paint.radius,
                            fill: surface,
                            stroke: selected === node.id ? ink : mutedInk,
                            strokeWidth: selected === node.id ? 2 : 1
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "text",
                          {
                            x: node.x + node.paint.inset,
                            y: node.y + node.paint.labelY,
                            fill: ink,
                            className: visual.nodeTitle(),
                            children: node.paint.label
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "text",
                          {
                            x: node.x + node.paint.inset,
                            y: node.y + node.paint.stateY,
                            fill: operationalToneInk(node.tone) ?? mutedInk,
                            className: visual.nodeText(),
                            children: short(node.state, 24)
                          }
                        ),
                        node.description && /* @__PURE__ */ jsx(
                          "text",
                          {
                            x: node.x + node.paint.inset,
                            y: node.y + node.paint.descriptionY,
                            fill: mutedInk,
                            className: visual.nodeText(),
                            children: node.paint.description
                          }
                        ),
                        node.percent !== null && /* @__PURE__ */ jsxs(Fragment, { children: [
                          /* @__PURE__ */ jsx(
                            "rect",
                            {
                              x: node.x + node.paint.inset,
                              y: node.y + node.paint.progressY,
                              width: node.width - node.paint.inset * 2,
                              height: node.paint.trackHeight,
                              fill: edge
                            }
                          ),
                          /* @__PURE__ */ jsx(
                            "rect",
                            {
                              x: node.x + node.paint.inset,
                              y: node.y + node.paint.progressY,
                              width: (node.width - node.paint.inset * 2) * node.percent / 100,
                              height: node.paint.trackHeight,
                              fill: ink
                            }
                          )
                        ] }),
                        node.portPositions.map((port) => /* @__PURE__ */ jsx(
                          "circle",
                          {
                            cx: port.x,
                            cy: port.y,
                            r: "3",
                            fill: surface,
                            stroke: mutedInk,
                            children: /* @__PURE__ */ jsx("title", { children: port.label })
                          },
                          port.id
                        ))
                      ]
                    },
                    node.id
                  ))
                ]
              }
            )
          }
        ),
        /* @__PURE__ */ jsx("ul", { className: visual.srOnly(), "aria-label": `${label} tasks`, children: data.nodes.map((node) => /* @__PURE__ */ jsxs("li", { children: [
          node.label,
          ": ",
          node.state,
          node.progress == null ? "" : `, ${node.progress}%`
        ] }, node.id)) })
      ]
    }
  );
}
var WorkflowDiagram_default = WorkflowDiagram;
export {
  WorkflowDiagram,
  WorkflowDiagram_default as default
};
