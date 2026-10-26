"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { scheduleOverlays, clippedWindow, markerPaint } from "../../src/core/schedule-overlays.js";
import { Fragment as Fragment2, useState } from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import { quietControl } from "@reddb-io/design-system/base";
import { visualizationControls } from "../../src/visualization-controls.variants.js";
import Frame from "./VisualizationFrame.js";
import Canvas from "./ChartCanvas.js";
import Mark from "./VisualizationMark.js";
import {
  intervalRows,
  intervalDomain
} from "../../src/intervals.js";
import {
  edge,
  ink,
  mutedInk,
  seriesColor,
  tint,
  project,
  ticks,
  number,
  short
} from "../../src/visualization.js";
function IntervalPlot(props) {
  const {
    data,
    kind,
    label,
    description,
    width,
    height,
    size,
    selected: initialSelected = "",
    onSelectedChange,
    interactive = true,
    detailHref,
    className = "",
    timeDomain,
    formatTime = number,
    formatDuration = number,
    collapsed: initialCollapsed = [],
    onCollapsedChange,
    markers = [],
    windows = [],
    showDetails = true
  } = props;
  const controls = visualizationControls();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useControllableValue(
    props.selected,
    initialSelected,
    props.onSelectedChange
  );
  const [collapsed, setCollapsed] = useControllableValue(
    props.collapsed,
    initialCollapsed,
    props.onCollapsedChange
  );
  const overlays = scheduleOverlays(markers, windows, data.map((item) => item.id));
  const visible = intervalRows(data, collapsed);
  const full = intervalDomain(data, timeDomain);
  const view = [
    full[0] + (full[1] - full[0]) * (1 - 1 / zoom) * offset,
    full[0] + (full[1] - full[0]) * (1 - 1 / zoom) * offset + (full[1] - full[0]) / zoom
  ];
  const rows = visible.map((d) => ({
    ...d,
    value: formatDuration(d.end - d.start),
    description: `${formatTime(d.start)} \u2192 ${formatTime(d.end)} \xB7 ${d.tone ?? "neutral"}`
  }));
  const active = data.find((d) => d.id === selected);
  const parents = data.filter((d) => data.some((c) => c.parentId === d.id));
  function select(id) {
    setSelected(id);
  }
  function toggle(id) {
    setCollapsed(
      collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]
    );
  }
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      Frame,
      {
        kind,
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
          const left = Math.min(
            w * 0.38,
            Math.max(
              128,
              ...visible.map(
                (d) => Math.min(28, d.label.length + d.depth * 2) * 7 + 24
              )
            )
          );
          const rowHeight = Math.max(
            unit * 0.8125,
            Math.min(unit * 1.125, (h - 42) / Math.max(1, visible.length))
          );
          const actualHeight = Math.max(h, 42 + visible.length * rowHeight);
          return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(Canvas, { width: w, height: actualHeight, label, children: [
            overlays.windows.map((window) => {
              const range = clippedWindow(window.start, window.end, view);
              const row = window.intervalId === void 0 ? -1 : visible.findIndex((item) => item.id === window.intervalId);
              if (!range || window.intervalId !== void 0 && row < 0) return null;
              const wx = project(range[0], view, left, w - 12), ww = project(range[1], view, left, w - 12) - wx;
              return /* @__PURE__ */ jsx("rect", { "data-schedule-window": window.id, x: wx, y: row < 0 ? 28 : 32 + row * rowHeight, width: ww, height: row < 0 ? actualHeight - 28 : rowHeight, fill: "var(--reddb-color-muted)", stroke: edge, strokeDasharray: "3 3", children: /* @__PURE__ */ jsx("title", { children: `${window.label}: ${formatTime(window.start)} \u2192 ${formatTime(window.end)}` }) }, window.id);
            }),
            ticks(view).map((tick, index) => {
              const x = project(tick, view, left, w - 12);
              return /* @__PURE__ */ jsxs(Fragment2, { children: [
                /* @__PURE__ */ jsx(
                  "line",
                  {
                    x1: x,
                    x2: x,
                    y1: 28,
                    y2: actualHeight,
                    stroke: edge
                  }
                ),
                /* @__PURE__ */ jsx(
                  "text",
                  {
                    x,
                    y: 16,
                    textAnchor: "middle",
                    fill: mutedInk,
                    className: "font-mono text-xs",
                    children: formatTime(
                      kind === "TraceWaterfall" ? tick - full[0] : tick
                    )
                  }
                )
              ] }, index);
            }),
            visible.map((item, i) => {
              const y = 36 + i * rowHeight;
              const x = project(item.start, view, left, w - 12);
              const end = project(item.end, view, left, w - 12);
              const color = item.tone && item.tone !== "neutral" ? `var(--reddb-color-feedback-${item.tone}-foreground)` : seriesColor(item.series);
              return /* @__PURE__ */ jsxs(Fragment2, { children: [
                /* @__PURE__ */ jsx(
                  "line",
                  {
                    x1: 0,
                    x2: w,
                    y1: y + rowHeight - 4,
                    y2: y + rowHeight - 4,
                    stroke: edge
                  }
                ),
                kind === "Gantt" ? /* @__PURE__ */ jsx(Fragment, { children: (item.dependencies ?? []).map((dep, index) => {
                  const source = visible.find((d) => d.id === dep);
                  const si = visible.findIndex((d) => d.id === dep);
                  return /* @__PURE__ */ jsx(Fragment2, { children: source ? (() => {
                    const dx = project(
                      source.end,
                      view,
                      left,
                      w - 12
                    );
                    return /* @__PURE__ */ jsx(Fragment, { children: dx >= left && dx <= w - 12 && x >= left && x <= w - 12 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                      "path",
                      {
                        d: `M${dx},${36 + si * rowHeight + 8} H${Math.min(w - 8, dx + 8)} V${y + 8} H${x}`,
                        fill: "none",
                        stroke: mutedInk,
                        strokeDasharray: "3 3"
                      }
                    ) }) : null });
                  })() : null }, index);
                }) }) : null,
                /* @__PURE__ */ jsxs(
                  Mark,
                  {
                    id: item.id,
                    label: `${item.label}: ${formatDuration(item.end - item.start)} \xB7 ${item.tone ?? "neutral"}`,
                    selected,
                    onSelect: interactive ? select : void 0,
                    children: [
                      /* @__PURE__ */ jsx(
                        "text",
                        {
                          x: item.depth * 12 + 4,
                          y: y + 12,
                          fill: selected === item.id ? ink : mutedInk,
                          className: "text-xs",
                          children: short(
                            item.label,
                            Math.max(
                              6,
                              Math.floor((left - item.depth * 12 - 16) / 7)
                            )
                          )
                        }
                      ),
                      end >= left && x <= w - 12 ? (() => {
                        const startX = Math.max(left, x);
                        const bw = Math.max(
                          2,
                          Math.min(w - 12, end) - startX
                        );
                        return /* @__PURE__ */ jsxs(Fragment, { children: [
                          /* @__PURE__ */ jsx(
                            "rect",
                            {
                              x: startX,
                              y,
                              width: bw,
                              height: 18,
                              rx: 3,
                              fill: tint(
                                color,
                                selected === item.id ? 40 : 18
                              ),
                              stroke: color,
                              strokeWidth: selected === item.id ? 2 : 1
                            }
                          ),
                          item.progress !== void 0 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                            "rect",
                            {
                              x: startX,
                              y: y + 14,
                              width: bw * item.progress,
                              height: 4,
                              fill: color
                            }
                          ) }) : null,
                          bw > 76 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                            "text",
                            {
                              x: startX + 6,
                              y: y + 12,
                              fill: ink,
                              className: "font-mono text-xs",
                              children: formatDuration(item.end - item.start)
                            }
                          ) }) : null,
                          item.tone === "danger" ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                            "text",
                            {
                              x: Math.min(w - 22, startX + bw - 10),
                              y: y + 12,
                              fill: color,
                              className: "text-xs font-medium",
                              children: "!"
                            }
                          ) }) : null
                        ] });
                      })() : null
                    ]
                  }
                )
              ] }, item.id);
            }),
            overlays.markers.filter((marker) => marker.time >= view[0] && marker.time <= view[1]).map((marker) => {
              const mx = project(marker.time, view, left, w - 12);
              return /* @__PURE__ */ jsxs("g", { className: "pointer-events-none", "data-schedule-marker": marker.id, children: [
                /* @__PURE__ */ jsx("line", { x1: mx, x2: mx, y1: 28, y2: actualHeight, stroke: markerPaint(marker.tone), strokeWidth: 2, strokeDasharray: "4 3" }),
                /* @__PURE__ */ jsx("text", { x: mx, y: 30, textAnchor: mx > (left + w) / 2 ? "end" : "start", fill: markerPaint(marker.tone), className: "text-xs", children: marker.label }),
                /* @__PURE__ */ jsx("title", { children: `${marker.label}: ${formatTime(marker.time)}` })
              ] }, marker.id);
            })
          ] }) });
        }
      }
    ),
    (overlays.markers.length > 0 || overlays.windows.length > 0) && /* @__PURE__ */ jsxs("ul", { "aria-label": `${label} schedule references`, className: "m-0 mt-[var(--reddb-spatial-gap-sm)] flex list-none flex-wrap gap-[var(--reddb-spatial-gap-md)] p-0 text-caption text-ink-muted", children: [
      overlays.markers.map((marker) => /* @__PURE__ */ jsxs("li", { children: [
        marker.label,
        ": ",
        formatTime(marker.time)
      ] }, marker.id)),
      overlays.windows.map((window) => /* @__PURE__ */ jsxs("li", { children: [
        window.label,
        ": ",
        formatTime(window.start),
        " \u2192 ",
        formatTime(window.end)
      ] }, window.id))
    ] }),
    interactive ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("div", { className: controls.root(), children: [
        /* @__PURE__ */ jsxs("label", { className: controls.field(), children: [
          "Zoom ",
          /* @__PURE__ */ jsx(
            "input",
            {
              "aria-label": `${label} zoom`,
              type: "range",
              className: controls.range(),
              min: "1",
              max: "16",
              step: "1",
              value: zoom,
              onChange: (event) => setZoom(Number(event.currentTarget.value))
            }
          ),
          /* @__PURE__ */ jsxs("span", { className: "font-mono", children: [
            zoom,
            "\xD7"
          ] })
        ] }),
        zoom > 1 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("label", { className: controls.field(), children: [
          "Position ",
          /* @__PURE__ */ jsx(
            "input",
            {
              "aria-label": `${label} position`,
              type: "range",
              className: controls.range(),
              min: "0",
              max: "1",
              step: "0.01",
              value: offset,
              onChange: (event) => setOffset(Number(event.currentTarget.value))
            }
          )
        ] }) }) : null,
        parents.map((parent, index) => {
          return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              "aria-expanded": !collapsed.includes(parent.id),
              onClick: () => toggle(parent.id),
              className: quietControl({
                class: controls.action({
                  class: "cursor-pointer underline focus-visible:outline-2 focus-visible:outline-focus"
                })
              }),
              children: [
                collapsed.includes(parent.id) ? "Expand" : "Collapse",
                " ",
                parent.label
              ]
            }
          ) }, index);
        })
      ] }),
      active && showDetails ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
        "section",
        {
          "aria-label": `${active.label} details`,
          className: "mt-[var(--reddb-spatial-gap-md)] border-t border-muted pt-[var(--reddb-spatial-inset-md)] text-xs",
          children: [
            /* @__PURE__ */ jsxs("p", { className: "m-0 font-medium", children: [
              active.label,
              " \xB7 ",
              formatDuration(active.end - active.start),
              " \xB7 ",
              active.tone ?? "neutral"
            ] }),
            active.description ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("p", { className: "text-ink-muted", children: active.description }) }) : null,
            active.attributes ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
              "dl",
              {
                className: "grid grid-cols-[auto_1fr] gap-x-[var(--reddb-spatial-gap-lg)] gap-y-[var(--reddb-spatial-gap-sm)] font-mono",
                children: Object.entries(active.attributes).map(
                  ([key, value], index) => {
                    return /* @__PURE__ */ jsxs(Fragment2, { children: [
                      /* @__PURE__ */ jsx("dt", { className: "text-ink-muted", children: key }),
                      /* @__PURE__ */ jsx("dd", { className: "m-0 break-all", children: value })
                    ] }, index);
                  }
                )
              }
            ) }) : null,
            active.href ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
              "a",
              {
                href: active.href,
                className: quietControl({
                  class: "underline focus-visible:outline-2 focus-visible:outline-focus"
                }),
                children: "Open details"
              }
            ) }) : null
          ]
        }
      ) }) : null
    ] }) : null
  ] });
}
var IntervalPlot_default = IntervalPlot;
export {
  IntervalPlot,
  IntervalPlot_default as default
};
