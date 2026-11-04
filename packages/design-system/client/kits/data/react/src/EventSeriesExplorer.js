import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, quietControl } from "@reddb-io/design-system/base";
import { TimeSeries } from "./TimeSeries.js";
import { Table } from "./Table.js";
import {
  normalizeEventPoints,
  bucketOptions,
  bucketLabel,
  effectiveBucketMs,
  seriesBuckets,
  formatEventTime,
  eventPayload
} from "../../src/event-series-explorer.js";
import { explorerClasses as styles } from "../../src/diff-explorer.variants.js";
function EventSeriesExplorer({
  label,
  series,
  context,
  emptyLabel = "No time series to inspect.",
  className = ""
}) {
  const [metric, setMetric] = useState(""), [mode, setMode] = useState("rate"), [requested, setRequested] = useState(6e4), [selected, setSelected] = useState(null);
  const current = series.find((item) => item.id === metric) ?? series[0], points = normalizeEventPoints(current?.points ?? []);
  const interval = effectiveBucketMs(points, requested), buckets = seriesBuckets(points, interval), selection = buckets.some((bucket) => bucket.t === selected) ? selected : null;
  const visible = points.filter(
    (point) => selection === null || point.t >= selection && point.t < selection + interval
  );
  const plot = mode === "rate" ? buckets.map((bucket) => ({ x: new Date(bucket.t), y: bucket.count })) : points.map((point) => ({ x: new Date(point.t), y: point.v }));
  const rows = visible.map((point, id) => ({
    id,
    time: formatEventTime(point.t),
    value: point.v,
    log: eventPayload(point.raw)
  }));
  const columns = [
    { key: "time", header: "time" },
    { key: "value", header: "value", align: "end" },
    { key: "log", header: "log" }
  ];
  const selectClass = styles.select;
  return /* @__PURE__ */ jsx(
    "section",
    {
      "data-event-series-explorer": true,
      "aria-label": label,
      className: `${styles.root} ${className}`,
      children: !current ? /* @__PURE__ */ jsx("p", { className: styles.detail, children: emptyLabel }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("div", { className: styles.toolbar, children: [
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: quietControl({
                selected: mode === "rate",
                class: "px-[var(--reddb-spatial-inset-sm)]"
              }),
              "aria-pressed": mode === "rate",
              onClick: () => setMode("rate"),
              children: [
                "Writes/",
                bucketLabel(interval)
              ]
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: quietControl({
                selected: mode === "line",
                class: "px-[var(--reddb-spatial-inset-sm)]"
              }),
              "aria-pressed": mode === "line",
              onClick: () => setMode("line"),
              children: "Value"
            }
          ),
          /* @__PURE__ */ jsxs("label", { className: "flex min-w-0 max-w-full flex-col", children: [
            "Metric",
            " ",
            /* @__PURE__ */ jsx(
              "select",
              {
                className: selectClass,
                value: current.id,
                onChange: (e) => {
                  setMetric(e.currentTarget.value);
                  setSelected(null);
                },
                children: series.map((item) => /* @__PURE__ */ jsx("option", { value: item.id, children: item.label }, item.id))
              }
            )
          ] }),
          mode === "rate" && /* @__PURE__ */ jsxs("label", { className: "flex min-w-0 max-w-full flex-col", children: [
            "Bucket",
            " ",
            /* @__PURE__ */ jsx(
              "select",
              {
                className: selectClass,
                value: requested,
                onChange: (e) => {
                  setRequested(Number(e.currentTarget.value));
                  setSelected(null);
                },
                children: bucketOptions.map((ms) => /* @__PURE__ */ jsx("option", { value: ms, children: bucketLabel(ms) }, ms))
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("label", { className: "flex min-w-0 max-w-full flex-col", children: [
            "Inspect bucket",
            " ",
            /* @__PURE__ */ jsxs(
              "select",
              {
                className: selectClass,
                value: selection === null ? "" : String(selection),
                onChange: (e) => setSelected(
                  e.currentTarget.value === "" ? null : Number(e.currentTarget.value)
                ),
                children: [
                  /* @__PURE__ */ jsx("option", { value: "", children: "All events" }),
                  buckets.map((bucket) => /* @__PURE__ */ jsxs("option", { value: String(bucket.t), children: [
                    formatEventTime(bucket.t),
                    " \xB7 ",
                    bucket.count,
                    " writes \xB7 sum",
                    " ",
                    bucket.sum
                  ] }, bucket.t))
                ]
              }
            )
          ] }),
          selection !== null && /* @__PURE__ */ jsx(Button, { onClick: () => setSelected(null), children: "Clear bucket" })
        ] }),
        /* @__PURE__ */ jsx(
          TimeSeries,
          {
            label: `${label}: ${mode === "rate" ? "writes per bucket" : current.label}`,
            data: plot,
            variant: mode === "rate" ? "bar" : "line",
            curve: "linear",
            size: "md",
            onSelect: mode === "rate" ? setSelected : void 0,
            interactive: true
          }
        ),
        /* @__PURE__ */ jsx(
          Table,
          {
            caption: `${label} events`,
            captionHidden: true,
            columns,
            rows,
            rowKey: "id",
            pageSize: 80,
            columnVisibility: false
          }
        ),
        /* @__PURE__ */ jsxs("p", { className: styles.detail, children: [
          visible.length,
          " inserts",
          context ? ` \xB7 ${context}` : "",
          selection !== null ? ` \xB7 bucket ${formatEventTime(selection)}` : ""
        ] })
      ] })
    }
  );
}
var EventSeriesExplorer_default = EventSeriesExplorer;
export {
  EventSeriesExplorer,
  EventSeriesExplorer_default as default
};
