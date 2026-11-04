import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  Checkbox,
  EmptyState,
  StateIllustration,
  quietControl
} from "@reddb-io/design-system/base";
import {
  tableEmptyCompact,
  searchEmpty
} from "@reddb-io/design-system/base/illustrations";
import { Table } from "./Table.js";
import {
  tableQueryRequest,
  filterTableRows,
  explorerTableColumns
} from "../../src/table-explorer.js";
import { explorerClasses as styles } from "../../src/diff-explorer.variants.js";
import { tableExplorerClasses as chrome } from "../../src/table-appearance.js";
function TableExplorer({
  label,
  columns,
  rows,
  rowKey,
  total,
  context,
  error,
  editable = false,
  changes = [],
  onchangeschange,
  queryColumns = [],
  onquery,
  onreset,
  describequery,
  identityLabel,
  className = ""
}) {
  const [filters, setFilters] = useState({}), [filtersOpen, setFiltersOpen] = useState(false), [projectionOpen, setProjectionOpen] = useState(false), [projection, setProjection] = useState({}), [limit, setLimit] = useState(200), [busy, setBusy] = useState(false), [queryError, setQueryError] = useState(null);
  const root = useRef(null), controller = useRef(void 0);
  useEffect(() => {
    controller.current?.abort();
    setFilters({});
    setProjection({});
    setQueryError(null);
    setBusy(false);
    return () => controller.current?.abort();
  }, [context]);
  const visible = filterTableRows(rows, filters), gridColumns = explorerTableColumns(columns, visible), count = Object.values(filters).filter((value) => value.trim()).length, request = tableQueryRequest(
    queryColumns.filter((key) => projection[key] !== false),
    limit
  );
  function reset() {
    controller.current?.abort();
    setBusy(false);
    onreset?.();
    clear();
    setQueryError(null);
  }
  function clear() {
    setFilters({});
    root.current?.querySelector("[data-table-filter-toggle]")?.focus();
  }
  async function run() {
    if (!onquery || busy) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setQueryError(null);
    try {
      await onquery(request, task.signal);
      if (!task.signal.aborted) setFilters({});
    } catch (cause) {
      if (!task.signal.aborted)
        setQueryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === task && !task.signal.aborted) {
        setBusy(false);
        root.current?.querySelector("[data-table-run-select]")?.focus();
      }
    }
  }
  function sourceKey(row) {
    return typeof rowKey === "function" ? rowKey(row, rows.indexOf(row)) : row[rowKey];
  }
  return /* @__PURE__ */ jsx(
    "section",
    {
      ref: root,
      "data-table-explorer": true,
      "aria-label": label,
      className: `${chrome.root} ${className}`,
      children: error ? /* @__PURE__ */ jsx("p", { role: "alert", className: styles.detail, children: error }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("div", { className: chrome.toolbar, children: [
          onquery && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx(
              Button,
              {
                "aria-pressed": projectionOpen,
                onClick: () => setProjectionOpen(!projectionOpen),
                children: "select"
              }
            ),
            /* @__PURE__ */ jsx(
              Button,
              {
                "data-table-run-select": true,
                disabled: busy,
                onClick: () => void run(),
                children: busy ? "Running\u2026" : "run"
              }
            ),
            onreset && /* @__PURE__ */ jsx(Button, { onClick: reset, children: "reset" })
          ] }),
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              "data-table-filter-toggle": true,
              className: quietControl({
                selected: filtersOpen,
                class: "min-h-[var(--reddb-spatial-control-height-sm)] rounded-sm border border-control-edge px-[var(--reddb-spatial-inset-sm)]"
              }),
              "aria-expanded": filtersOpen,
              "aria-pressed": filtersOpen,
              onClick: () => setFiltersOpen(!filtersOpen),
              children: [
                "filters",
                count ? ` ${count}` : ""
              ]
            }
          ),
          count > 0 && /* @__PURE__ */ jsx(Button, { title: "Clear all filters", onClick: clear, children: "clear" }),
          /* @__PURE__ */ jsxs("span", { children: [
            visible.length,
            " of ",
            total ?? rows.length,
            " rows"
          ] })
        ] }),
        projectionOpen && onquery && /* @__PURE__ */ jsxs("div", { className: styles.detail, children: [
          /* @__PURE__ */ jsxs("div", { className: chrome.toolbar, children: [
            /* @__PURE__ */ jsx("span", { children: "Columns" }),
            /* @__PURE__ */ jsx(Button, { onClick: () => setProjection({}), children: "all" }),
            /* @__PURE__ */ jsx(
              Button,
              {
                onClick: () => setProjection(
                  Object.fromEntries(
                    queryColumns.map((key) => [key, false])
                  )
                ),
                children: "none"
              }
            ),
            /* @__PURE__ */ jsxs("label", { children: [
              "Limit",
              " ",
              /* @__PURE__ */ jsx(
                Input,
                {
                  "aria-label": "Limit",
                  type: "number",
                  min: "1",
                  max: "1000",
                  value: limit,
                  onChange: (e) => setLimit(Number(e.currentTarget.value))
                }
              )
            ] })
          ] }),
          /* @__PURE__ */ jsx("div", { className: chrome.toolbar, children: queryColumns.map((key) => /* @__PURE__ */ jsx(
            Checkbox,
            {
              label: key,
              checked: projection[key] !== false,
              onCheckedChange: (value) => setProjection({ ...projection, [key]: value })
            },
            key
          )) }),
          describequery && /* @__PURE__ */ jsx("pre", { className: styles.value, children: describequery(request) })
        ] }),
        queryError && /* @__PURE__ */ jsx("p", { role: "alert", className: styles.detail, children: queryError }),
        filtersOpen && /* @__PURE__ */ jsx("div", { className: chrome.filters, "data-table-filters": true, children: columns.map((column) => /* @__PURE__ */ jsxs("label", { className: chrome.filter, children: [
          column.header,
          /* @__PURE__ */ jsx(
            Input,
            {
              "aria-label": `Filter ${column.key}`,
              value: filters[column.key] ?? "",
              onChange: (e) => setFilters({
                ...filters,
                [column.key]: e.currentTarget.value
              })
            }
          )
        ] }, column.key)) }),
        !rows.length ? /* @__PURE__ */ jsx(
          "div",
          {
            "data-renderer-empty": "table",
            "data-empty-reason": "empty",
            className: styles.detail,
            children: /* @__PURE__ */ jsx(
              EmptyState,
              {
                title: "No rows returned",
                description: "This query returned no rows. Adjust the query or run it again.",
                bordered: false,
                media: /* @__PURE__ */ jsx(StateIllustration, { art: tableEmptyCompact, size: "md" }),
                actions: onquery ? /* @__PURE__ */ jsx(Button, { disabled: busy, onClick: () => void run(), children: "Run SELECT again" }) : void 0
              }
            )
          }
        ) : /* @__PURE__ */ jsx(
          Table,
          {
            caption: label,
            className: "font-mono",
            containerClass: chrome.grid,
            captionHidden: true,
            columns: gridColumns,
            rows: visible,
            rowKey: sourceKey,
            editable,
            changes,
            onChangesChange: onchangeschange,
            pageSize: 80,
            columnVisibility: false,
            cell: ({ column, value, text }) => column.key !== gridColumns[0]?.key && value == null ? /* @__PURE__ */ jsx("span", { className: "italic text-ink-muted", children: "NULL" }) : /* @__PURE__ */ jsx("span", { className: "block max-w-prose truncate", children: text }),
            empty: /* @__PURE__ */ jsx("div", { "data-renderer-empty": "table", "data-empty-reason": "filtered", children: /* @__PURE__ */ jsx(
              EmptyState,
              {
                title: "No rows match these filters",
                description: "Clear the column filters to show the returned rows.",
                bordered: false,
                media: /* @__PURE__ */ jsx(StateIllustration, { art: searchEmpty, size: "sm" }),
                actions: /* @__PURE__ */ jsx(Button, { onClick: clear, children: "Clear filters" })
              }
            ) })
          }
        ),
        /* @__PURE__ */ jsxs("p", { className: chrome.footer, children: [
          visible.length,
          " of ",
          total ?? rows.length,
          " rows",
          context ? ` \xB7 ${context}` : "",
          identityLabel ? ` \xB7 ${identityLabel}` : "",
          editable ? " \xB7 double-click or press Enter to stage an edit" : ""
        ] })
      ] })
    }
  );
}
var TableExplorer_default = TableExplorer;
export {
  TableExplorer,
  TableExplorer_default as default
};
