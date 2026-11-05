"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Badge, Button, DescriptionList, Input, Tabs } from "@reddb-io/design-system/base";
import { ListRow, Toolbar } from "@reddb-io/design-system/app";
import { filterDeveloperRequests, formatRequestDuration, formatRequestDetails, developerRequestStatusTone } from "../../src/developer-panel.js";
import { developerPanelClasses as styles } from "../../src/developer-panel.variants.js";
function DeveloperRequestInspector({ requests, onRequestsChange, requestActions, children }) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [tab, setTab] = useState("request");
  const tabItems = [{ value: "request", label: "Request" }, { value: "response", label: "Response" }, { value: "headers", label: "Headers" }, { value: "timing", label: "Timing" }, ...children ? [{ value: "tools", label: "Tools" }] : []];
  const filtered = filterDeveloperRequests([...requests].reverse(), filter);
  const active = filtered.find((item) => item.id === selected) ?? filtered[0];
  useEffect(() => {
    setCopyMessage("");
  }, [active?.id, tab]);
  useEffect(() => {
    if (!children && tab === "tools") setTab("request");
  }, [children, tab]);
  async function copyDetails() {
    if (!active || tab === "tools") return;
    try {
      await navigator.clipboard.writeText(formatRequestDetails(active, tab));
      setCopyMessage("Copied.");
    } catch {
      setCopyMessage("Copy failed.");
    }
  }
  return /* @__PURE__ */ jsxs("div", { className: `${styles.content} h-full`, children: [
    /* @__PURE__ */ jsxs("div", { className: styles.list, role: "region", "aria-label": "Requests", tabIndex: 0, children: [
      /* @__PURE__ */ jsxs("div", { className: styles.listToolbar, children: [
        /* @__PURE__ */ jsx(Input, { controlSize: "sm", type: "search", "aria-label": "Filter requests", placeholder: "Filter requests", value: filter, onChange: (event) => setFilter(event.currentTarget.value) }),
        onRequestsChange && /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "sm", className: "shrink-0 whitespace-nowrap", "aria-label": "Clear requests", onClick: () => onRequestsChange([]), children: "Clear" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: styles.listRows, role: "region", "aria-label": "Request list", tabIndex: 0, children: [
        !filtered.length && /* @__PURE__ */ jsx("p", { className: `${styles.detail} ${styles.muted}`, children: requests.length ? "No requests match the filter." : "No requests recorded." }),
        filtered.map((item) => /* @__PURE__ */ jsx(ListRow, { size: "sm", selected: active?.id === item.id, "aria-pressed": active?.id === item.id, className: `${styles.row} py-0`, onClick: () => setSelected(item.id), leading: /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-[var(--reddb-spatial-gap-sm)]", children: [
          item.timeLabel && /* @__PURE__ */ jsx("span", { className: `${styles.muted} max-w-[10ch] shrink-0 truncate`, title: item.timeLabel, children: item.timeLabel }),
          item.source && /* @__PURE__ */ jsx("span", { className: `${styles.muted} max-w-[8ch] shrink-0 truncate`, title: item.source, children: item.source })
        ] }), trailing: /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Badge, { tone: developerRequestStatusTone(item.status), children: item.status }),
          /* @__PURE__ */ jsx("span", { className: styles.muted, children: formatRequestDuration(item.durationMs) })
        ] }), children: /* @__PURE__ */ jsxs("span", { className: "flex min-w-0 items-center gap-[var(--reddb-spatial-gap-sm)]", children: [
          /* @__PURE__ */ jsx("span", { className: "shrink-0", children: item.method }),
          /* @__PURE__ */ jsx("span", { className: "min-w-0 truncate", children: item.target })
        ] }) }, item.id))
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: styles.detail, role: "region", "aria-label": "Request details", tabIndex: 0, children: [
      active && /* @__PURE__ */ jsxs("div", { "data-developer-request-summary": true, className: styles.summary, children: [
        /* @__PURE__ */ jsx("span", { children: active.method }),
        /* @__PURE__ */ jsx("span", { className: styles.summaryTarget, title: active.target, children: active.target }),
        /* @__PURE__ */ jsx(Badge, { tone: developerRequestStatusTone(active.status), children: active.status }),
        /* @__PURE__ */ jsx("span", { className: styles.muted, children: formatRequestDuration(active.durationMs) }),
        requestActions && /* @__PURE__ */ jsx("div", { className: styles.requestActions, children: requestActions(active) })
      ] }),
      /* @__PURE__ */ jsx(Tabs, { label: "Request views", items: tabItems, triggerClass: "text-caption", value: tab, onValueChange: (value) => {
        if (value === "request" || value === "response" || value === "headers" || value === "timing" || value === "tools") setTab(value);
      }, className: styles.tabs, contentClass: styles.detailBody, actions: /* @__PURE__ */ jsxs(Fragment, { children: [
        active && tab !== "tools" && /* @__PURE__ */ jsx(Toolbar, { label: "Request actions", size: "sm", className: styles.tabActions, items: [{ id: "copy", label: "Copy details", onselect: copyDetails }] }),
        /* @__PURE__ */ jsx("span", { className: "sr-only", role: "status", children: copyMessage })
      ] }), children: ({ value: panel }) => {
        const headers = panel === "request" ? active?.requestHeaders : active?.responseHeaders;
        const body = panel === "request" ? active?.requestBody : active?.responseBody;
        return /* @__PURE__ */ jsx(Fragment, { children: panel === "tools" && children ? children : !active ? /* @__PURE__ */ jsx("p", { className: styles.muted, children: "Select a request to inspect it." }) : panel === "headers" ? /* @__PURE__ */ jsxs("div", { className: styles.stack, children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("p", { className: "font-medium", children: "Response headers" }),
            active.responseHeaders?.length ? /* @__PURE__ */ jsx(DescriptionList, { gap: "sm", items: active.responseHeaders.map(([term, detail]) => ({ term, detail })) }) : /* @__PURE__ */ jsx("p", { className: styles.muted, children: "Not available." })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("p", { className: "font-medium", children: "Request headers" }),
            active.requestHeaders?.length ? /* @__PURE__ */ jsx(DescriptionList, { gap: "sm", items: active.requestHeaders.map(([term, detail]) => ({ term, detail })) }) : /* @__PURE__ */ jsx("p", { className: styles.muted, children: "Not available." })
          ] })
        ] }) : panel === "timing" ? /* @__PURE__ */ jsxs("div", { className: styles.stack, children: [
          /* @__PURE__ */ jsxs("p", { children: [
            "Total: ",
            formatRequestDuration(active.durationMs)
          ] }),
          active.phases?.length ? /* @__PURE__ */ jsxs("table", { children: [
            /* @__PURE__ */ jsx("caption", { className: "sr-only", children: "Measured phases" }),
            /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
              /* @__PURE__ */ jsx("th", { className: styles.cell, children: "Phase" }),
              /* @__PURE__ */ jsx("th", { className: styles.cell, children: "Start" }),
              /* @__PURE__ */ jsx("th", { className: styles.cell, children: "Duration" })
            ] }) }),
            /* @__PURE__ */ jsx("tbody", { children: active.phases.map((phase, index) => /* @__PURE__ */ jsxs("tr", { children: [
              /* @__PURE__ */ jsx("th", { scope: "row", className: styles.cell, children: phase.label }),
              /* @__PURE__ */ jsx("td", { className: styles.cell, children: formatRequestDuration(phase.startMs) }),
              /* @__PURE__ */ jsx("td", { className: styles.cell, children: formatRequestDuration(phase.durationMs) })
            ] }, `${phase.label}-${index}`)) })
          ] }) : /* @__PURE__ */ jsx("p", { className: styles.muted, children: "Timing phases not available." }),
          !!active.connection?.length && /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("p", { className: "font-medium", children: "Connection" }),
            /* @__PURE__ */ jsx(DescriptionList, { gap: "sm", items: active.connection.map(([term, detail]) => ({ term, detail })) })
          ] })
        ] }) : /* @__PURE__ */ jsxs("div", { className: styles.stack, children: [
          /* @__PURE__ */ jsxs("p", { className: styles.text, children: [
            active.method,
            " ",
            active.target,
            " \xB7 ",
            active.status
          ] }),
          active.error && panel === "response" && /* @__PURE__ */ jsx("p", { children: active.error }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("p", { className: "font-medium", children: "Headers" }),
            headers?.length ? /* @__PURE__ */ jsx(DescriptionList, { gap: "sm", items: headers.map(([term, detail]) => ({ term, detail })) }) : /* @__PURE__ */ jsx("p", { className: styles.muted, children: "Not available." })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("p", { className: "font-medium", children: "Body" }),
            body !== void 0 ? /* @__PURE__ */ jsx("pre", { className: styles.text, children: body }) : /* @__PURE__ */ jsx("p", { className: styles.muted, children: "Not available." })
          ] })
        ] }) });
      } })
    ] })
  ] });
}
var DeveloperRequestInspector_default = DeveloperRequestInspector;
export {
  DeveloperRequestInspector,
  DeveloperRequestInspector_default as default
};
