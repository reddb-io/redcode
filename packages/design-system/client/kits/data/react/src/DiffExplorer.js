import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { Checkbox, Input, quietControl } from "@reddb-io/design-system/base";
import { explorerFields, filterExplorerEntries, formatExplorerValue, summarizeExplorerEntries } from "../../src/diff-explorer.js";
import { explorerClasses as styles } from "../../src/diff-explorer.variants.js";
import { explorerFields as explorerFields2, filterExplorerEntries as filterExplorerEntries2, formatExplorerValue as formatExplorerValue2, summarizeExplorerEntries as summarizeExplorerEntries2 } from "../../src/diff-explorer.js";
function DiffExplorer({ label, entries, context, emptyLabel = "No changes to inspect.", className = "" }) {
  const [mode, setMode] = useState("summary");
  const [filter, setFilter] = useState("");
  const filterInput = useRef(null);
  const [selected, setSelected] = useState(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const filtered = filterExplorerEntries(entries, filter);
  const summary = summarizeExplorerEntries(entries);
  const active = filtered.find((entry) => entry.id === selected) ?? filtered[0] ?? null;
  const fields = active ? explorerFields(active) : [];
  const visible = showUnchanged ? fields : fields.filter((field) => field.status !== "unchanged");
  return /* @__PURE__ */ jsx("section", { "data-diff-explorer": true, "aria-label": label, className: `@container ${styles.root} ${className}`, children: entries.length === 0 ? /* @__PURE__ */ jsx("p", { className: styles.detail, children: emptyLabel }) : /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: styles.toolbar, children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: quietControl({ selected: mode === "summary", class: "px-[var(--reddb-spatial-inset-sm)]" }), "aria-pressed": mode === "summary", onClick: () => setMode("summary"), children: "Diff" }),
      /* @__PURE__ */ jsx("button", { type: "button", className: quietControl({ selected: mode === "raw", class: "px-[var(--reddb-spatial-inset-sm)]" }), "aria-pressed": mode === "raw", onClick: () => setMode("raw"), children: "Raw" }),
      /* @__PURE__ */ jsxs("label", { children: [
        "Filter ",
        /* @__PURE__ */ jsx(Input, { type: "search", "aria-label": "Filter", ref: filterInput, value: filter, onChange: (event) => setFilter(event.currentTarget.value) })
      ] }),
      filter && /* @__PURE__ */ jsx("button", { type: "button", className: quietControl({ class: "px-[var(--reddb-spatial-inset-sm)]" }), onClick: () => {
        setFilter("");
        filterInput.current?.focus();
      }, children: "Clear filter" }),
      summary.map(([change, count]) => /* @__PURE__ */ jsxs("span", { children: [
        change,
        " ",
        count
      ] }, change)),
      context && /* @__PURE__ */ jsx("span", { className: styles.muted, children: context })
    ] }),
    filtered.length === 0 ? /* @__PURE__ */ jsx("p", { className: styles.detail, children: "No changes match the filter." }) : mode === "raw" ? /* @__PURE__ */ jsx("pre", { className: styles.raw, children: formatExplorerValue(filtered.map((entry) => entry.raw)) }) : /* @__PURE__ */ jsxs("div", { className: styles.content, children: [
      /* @__PURE__ */ jsx("div", { className: styles.list, role: "region", "aria-label": "Changes", tabIndex: 0, children: filtered.map((entry) => /* @__PURE__ */ jsxs("button", { type: "button", className: quietControl({ selected: active?.id === entry.id, focus: "inset", class: styles.row }), "aria-pressed": active?.id === entry.id, onClick: () => setSelected(entry.id), children: [
        /* @__PURE__ */ jsx("span", { children: entry.change }),
        /* @__PURE__ */ jsx("span", { children: entry.entityId ?? entry.id }),
        entry.group && /* @__PURE__ */ jsx("span", { className: styles.muted, children: entry.group }),
        entry.note && /* @__PURE__ */ jsx("span", { children: entry.note })
      ] }, entry.id)) }),
      active && /* @__PURE__ */ jsxs("div", { className: styles.detail, role: "region", "aria-label": "Change details", tabIndex: 0, children: [
        /* @__PURE__ */ jsxs("p", { children: [
          active.change,
          " \xB7 ",
          active.entityId ?? active.id,
          active.group && /* @__PURE__ */ jsxs(Fragment, { children: [
            " \xB7 ",
            active.group
          ] })
        ] }),
        active.note && /* @__PURE__ */ jsx("p", { children: active.note }),
        fields.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Checkbox, { label: "Show unchanged fields", checked: showUnchanged, onCheckedChange: setShowUnchanged }),
          /* @__PURE__ */ jsxs("p", { children: [
            visible.length,
            "/",
            fields.length,
            " fields"
          ] }),
          visible.length === 0 ? /* @__PURE__ */ jsx("p", { children: "No changed fields in this row." }) : /* @__PURE__ */ jsx("div", { role: "region", "aria-label": "Field comparison", tabIndex: 0, className: "max-w-full shrink-0 overflow-x-auto", children: /* @__PURE__ */ jsxs("table", { className: "w-full min-w-max text-left", children: [
            /* @__PURE__ */ jsx("caption", { className: "sr-only", children: "Field comparison" }),
            /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
              /* @__PURE__ */ jsx("th", { scope: "col", className: styles.cell, children: "Status" }),
              /* @__PURE__ */ jsx("th", { scope: "col", className: styles.cell, children: "Field" }),
              /* @__PURE__ */ jsx("th", { scope: "col", className: styles.cell, children: "Before" }),
              /* @__PURE__ */ jsx("th", { scope: "col", className: styles.cell, children: "After" })
            ] }) }),
            /* @__PURE__ */ jsx("tbody", { children: visible.map((field) => /* @__PURE__ */ jsxs("tr", { children: [
              /* @__PURE__ */ jsx("td", { className: styles.cell, children: field.status }),
              /* @__PURE__ */ jsx("th", { scope: "row", className: styles.cell, children: field.field }),
              /* @__PURE__ */ jsx("td", { className: styles.cell, children: /* @__PURE__ */ jsx("pre", { className: styles.value, children: formatExplorerValue(field.before) }) }),
              /* @__PURE__ */ jsx("td", { className: styles.cell, children: /* @__PURE__ */ jsx("pre", { className: styles.value, children: formatExplorerValue(field.after) }) })
            ] }, field.field)) })
          ] }) })
        ] }),
        /* @__PURE__ */ jsx("p", { children: "Full before" }),
        /* @__PURE__ */ jsx("pre", { className: styles.value, children: formatExplorerValue(active.before) }),
        /* @__PURE__ */ jsx("p", { children: "Full after" }),
        /* @__PURE__ */ jsx("pre", { className: styles.value, children: formatExplorerValue(active.after) })
      ] })
    ] })
  ] }) });
}
var DiffExplorer_default = DiffExplorer;
export {
  DiffExplorer,
  DiffExplorer_default as default,
  explorerFields2 as explorerFields,
  filterExplorerEntries2 as filterExplorerEntries,
  formatExplorerValue2 as formatExplorerValue,
  summarizeExplorerEntries2 as summarizeExplorerEntries
};
