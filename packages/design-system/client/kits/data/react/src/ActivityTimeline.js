"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { Button } from "@reddb-io/design-system/base";
import { activityTimelineModel } from "../../src/activity-timeline.js";
import { activityTimeline } from "../../src/activity-timeline.variants.js";
function ActivityTimeline({ label, rows, domain, formatTime = String, endLabel = "Scroll to end", className = "" }) {
  const viewport = useRef(null), model = activityTimelineModel(rows, domain), styles = activityTimeline();
  return /* @__PURE__ */ jsxs("section", { "data-activity-timeline": true, "aria-label": label, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx("div", { ref: viewport, className: styles.scroll(), tabIndex: 0, role: "region", "aria-label": `${label} timeline`, children: /* @__PURE__ */ jsx("ol", { className: styles.rows(), children: model.rows.map((row) => /* @__PURE__ */ jsxs("li", { className: styles.row(), children: [
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
    /* @__PURE__ */ jsx("div", { className: styles.action(), children: /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", onClick: () => viewport.current?.scrollTo({ left: viewport.current.scrollWidth }), children: endLabel }) })
  ] });
}
var ActivityTimeline_default = ActivityTimeline;
export {
  ActivityTimeline,
  ActivityTimeline_default as default
};
