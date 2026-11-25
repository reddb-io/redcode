"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { Alert, Button, ContentState, LoadingIndicator, collectionView } from "@reddb-io/design-system/base";
import { activityTimelineModel } from "../../src/activity-timeline.js";
import { activityTimeline } from "../../src/activity-timeline.variants.js";
function ActivityTimeline({
  label,
  rows,
  domain,
  formatTime = String,
  endLabel = "Scroll to end",
  state,
  errorMessage = "Could not load activity.",
  retryLabel = "Retry",
  loadingRows = 5,
  onretry,
  className = ""
}) {
  const viewport = useRef(null), model = activityTimelineModel(rows, domain), styles = activityTimeline(), view = collectionView(state, rows.length);
  return /* @__PURE__ */ jsxs("section", { "data-activity-timeline": true, "data-state": state ?? "ready", "aria-busy": view.busy ? true : void 0, "aria-label": label, className: styles.root({ class: className }), children: [
    view.stale && /* @__PURE__ */ jsxs(Alert, { tone: "danger", className: styles.alert(), children: [
      errorMessage,
      onretry && /* @__PURE__ */ jsxs(Fragment, { children: [
        " ",
        /* @__PURE__ */ jsx(Button, { size: "sm", variant: "secondary", onClick: onretry, children: retryLabel })
      ] })
    ] }),
    view.placeholder ? /* @__PURE__ */ jsx(ContentState, { state: view.placeholder, label, emptyTitle: "No activity", errorMessage, retryLabel, onRetry: onretry, shape: "list", rows: loadingRows, children: /* @__PURE__ */ jsx("span", {}) }) : /* @__PURE__ */ jsx("div", { ref: viewport, className: styles.scroll(), tabIndex: 0, role: "region", "aria-label": `${label} timeline`, children: /* @__PURE__ */ jsx("ol", { className: styles.rows(), children: model.rows.map((row) => /* @__PURE__ */ jsxs("li", { className: styles.row(), children: [
      /* @__PURE__ */ jsxs("div", { className: styles.header(), children: [
        /* @__PURE__ */ jsxs("p", { className: styles.title(), children: [
          row.label,
          row.context && /* @__PURE__ */ jsxs("span", { className: "font-regular text-ink-muted", children: [
            " \xB7 ",
            row.context
          ] })
        ] }),
        row.value && /* @__PURE__ */ jsx("span", { className: "text-body tabular-nums", children: row.value })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: styles.header(), children: [
        /* @__PURE__ */ jsx("p", { className: styles.meta(), children: row.summary ?? "" }),
        row.detail && /* @__PURE__ */ jsx("p", { className: styles.meta(), children: row.detail })
      ] }),
      /* @__PURE__ */ jsx("div", { "data-activity-track": true, "aria-hidden": "true", className: styles.track(), style: { height: `calc(var(--reddb-spatial-gap-md) * ${Math.max(1, ...row.events.map((event) => event.lane + 1))})` }, children: row.events.map((event) => /* @__PURE__ */ jsx("span", { "data-activity-event": event.id, className: styles.event(), style: { left: `${event.left}%`, width: event.start === event.end ? "1px" : `${event.width}%`, top: `calc(var(--reddb-spatial-gap-md) * ${event.lane})`, height: "var(--reddb-spatial-gap-sm)", background: `var(--reddb-color-series-${event.series ?? 1})` } }, event.id)) }),
      /* @__PURE__ */ jsx("ul", { className: "sr-only", children: row.events.map((event) => /* @__PURE__ */ jsxs("li", { children: [
        event.label,
        ": ",
        formatTime(event.start),
        " \u2013 ",
        formatTime(event.end)
      ] }, event.id)) })
    ] }, row.id)) }) }),
    /* @__PURE__ */ jsxs("div", { className: styles.action(), children: [
      state === "refreshing" && !view.placeholder && /* @__PURE__ */ jsx(LoadingIndicator, { size: "sm", label: "Refreshing" }),
      /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", onClick: () => viewport.current?.scrollTo({ left: viewport.current.scrollWidth }), children: endLabel })
    ] })
  ] });
}
var ActivityTimeline_default = ActivityTimeline;
export {
  ActivityTimeline,
  ActivityTimeline_default as default
};
