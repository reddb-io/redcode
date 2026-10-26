"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  Fragment as Fragment2,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import {
  Button,
  Checkbox,
  Input,
  quietControl
} from "@reddb-io/design-system/base";
import {
  filterRows,
  paginateRows,
  sortRows,
  stageChange,
  valueWithChanges,
  virtualWindow
} from "../../src/table.js";
export * from "../../src/table.js";
function Table(props) {
  const {
    caption,
    columns,
    rows,
    rowKey,
    editable = false,
    changes: controlledChanges,
    onChangesChange,
    sort: controlledSort,
    onSortChange,
    filters: controlledFilters,
    onFiltersChange,
    page: controlledPage,
    pageSize = 25,
    onPageChange,
    virtualize = false,
    captionHidden = false,
    columnVisibility = true,
    actions,
    cell,
    empty,
    emptyMessage = "No rows",
    selectedRow = null,
    onSelect,
    className = "",
    containerClass = ""
  } = props;
  const [localChanges, setLocalChanges] = useState([]);
  const [localSort, setLocalSort] = useState(null);
  const [localFilters, setLocalFilters] = useState({});
  const [localPage, setLocalPage] = useState(1);
  const [visibility, setVisibility] = useState({});
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredRowHeight, setMeasuredRowHeight] = useState(void 0);
  const [active, setActive] = useState({ row: 0, column: 0 });
  const [editing, setEditingState] = useState(null);
  const grid = useRef(null), editor = useRef(null), editingSession = useRef(null);
  function setEditing(next) {
    editingSession.current = next;
    setEditingState(next);
  }
  useLayoutEffect(() => {
    if (editing) {
      editor.current?.focus();
      editor.current?.select();
    }
  }, [editing?.rowKey, editing?.columnKey]);
  function reportPage(page) {
    onPageChange?.(page);
  }
  const activeChanges = controlledChanges ?? localChanges;
  const activeSort = controlledSort === void 0 ? localSort : controlledSort;
  const activeFilters = controlledFilters ?? localFilters;
  const requestedPage = controlledPage ?? localPage;
  const visibleColumns = columns.filter(
    (column) => visibility[column.key] !== false
  );
  const filteredRows = filterRows(rows, columns, activeFilters);
  const sortedRows = sortRows(filteredRows, columns, activeSort);
  const pagination = paginateRows(sortedRows, {
    page: requestedPage,
    pageSize
  });
  const windowed = virtualize ? virtualWindow(pagination.rows, {
    ...virtualize,
    rowHeight: measuredRowHeight ?? virtualize.rowHeight,
    scrollTop
  }) : {
    items: pagination.rows,
    start: 0,
    end: pagination.rows.length,
    offsetTop: 0,
    offsetBottom: 0,
    totalHeight: pagination.rows.length
  };
  function keyFor(row, index) {
    if (typeof rowKey === "function") return rowKey(row, index);
    if (typeof rowKey === "string") {
      const value = row[rowKey];
      if (typeof value === "string" || typeof value === "number") return value;
    }
    return index;
  }
  const filterableColumns = columns.filter((column) => column.filterable);
  const selectable = onSelect !== void 0;
  function selectRow(row, rowPosition) {
    const key = keyFor(row, pagination.start + windowed.start + rowPosition);
    onSelect?.(key, row);
  }
  function textFor(column, value, row) {
    return column.format ? column.format(value, row) : String(value ?? "");
  }
  function canEdit(row, column) {
    if (column.editable !== true) return false;
    return typeof editable === "function" ? editable(row, column) : editable;
  }
  function hasChange(rowKeyValue, columnKey) {
    return activeChanges.some(
      (change) => change.rowKey === rowKeyValue && change.columnKey === columnKey
    );
  }
  function setFilters(columnKey, query) {
    const next = { ...activeFilters, [columnKey]: query };
    setLocalFilters(next);
    setLocalPage(1);
    onFiltersChange?.(next);
    if (controlledPage !== void 0) reportPage(1);
  }
  function toggleColumn(columnKey) {
    const next = {
      ...visibility,
      [columnKey]: visibility[columnKey] === false
    };
    setVisibility(next);
    setActive({
      row: active.row,
      column: Math.min(
        active.column,
        columns.filter((column) => next[column.key] !== false).length - 1
      )
    });
  }
  function toggleSort(column) {
    if (!column.sortable) return;
    let next;
    if (activeSort?.key !== column.key)
      next = { key: column.key, direction: "ascending" };
    else if (activeSort.direction === "ascending") {
      next = { key: column.key, direction: "descending" };
    } else next = null;
    setLocalSort(next);
    setLocalPage(1);
    onSortChange?.(next);
  }
  function sortValue(column) {
    return activeSort?.key === column.key ? activeSort.direction : "none";
  }
  function focusCell(row, column) {
    const rowCount = windowed.items.length;
    if (rowCount === 0 || visibleColumns.length === 0) return;
    const next = {
      row: Math.min(rowCount - 1, Math.max(0, row)),
      column: Math.min(visibleColumns.length - 1, Math.max(0, column))
    };
    setActive(next);
    grid.current?.querySelector(
      `[data-cell-row="${next.row}"][data-cell-column="${next.column}"]`
    )?.focus();
  }
  function beginEdit(row, rowPosition, column, columnPosition, value) {
    if (!canEdit(row, column)) return;
    const dataIndex = pagination.start + windowed.start + rowPosition;
    setEditing({
      rowKey: keyFor(row, dataIndex),
      columnKey: column.key,
      row,
      rowPosition,
      columnPosition,
      previous: row[column.key],
      input: textFor(column, value, row)
    });
  }
  function finishEdit(commit, restoreFocus = true) {
    const current = editingSession.current;
    if (!current) return;
    editingSession.current = null;
    if (commit) {
      const column = columns.find(
        (candidate) => candidate.key === current.columnKey
      );
      let value = current.input;
      if (column.parse)
        value = column.parse(current.input, current.previous, current.row);
      else if (typeof current.previous === "number" && current.input.trim() !== "") {
        const numeric = Number(current.input);
        if (Number.isFinite(numeric)) value = numeric;
      }
      const next = stageChange(activeChanges, {
        rowKey: current.rowKey,
        columnKey: current.columnKey,
        previous: current.previous,
        value
      });
      setLocalChanges(next);
      onChangesChange?.(next);
    }
    setEditing(null);
    if (restoreFocus) focusCell(current.rowPosition, current.columnPosition);
  }
  function handleCellKeydown(event, row, rowPosition, column, columnPosition, value) {
    if (event.target !== event.currentTarget) return;
    let destination;
    if (event.key === "ArrowRight")
      destination = { row: rowPosition, column: columnPosition + 1 };
    else if (event.key === "ArrowLeft")
      destination = { row: rowPosition, column: columnPosition - 1 };
    else if (event.key === "ArrowDown")
      destination = { row: rowPosition + 1, column: columnPosition };
    else if (event.key === "ArrowUp")
      destination = { row: rowPosition - 1, column: columnPosition };
    else if (event.key === "Home")
      destination = { row: rowPosition, column: 0 };
    else if (event.key === "End") {
      destination = { row: rowPosition, column: visibleColumns.length - 1 };
    } else if (event.key === "Enter" || event.key === "F2") {
      if (canEdit(row, column)) {
        event.preventDefault();
        beginEdit(row, rowPosition, column, columnPosition, value);
      } else if (event.key === "Enter" && selectable) {
        event.preventDefault();
        selectRow(row, rowPosition);
      }
      return;
    } else if (event.key === " " && selectable && !canEdit(row, column)) {
      event.preventDefault();
      selectRow(row, rowPosition);
      return;
    }
    if (destination) {
      event.preventDefault();
      focusCell(destination.row, destination.column);
    }
  }
  function handleEditorKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      finishEdit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishEdit(false);
    }
  }
  function alignClass(column) {
    return column.align === "end" ? "text-end tabular-nums" : "text-start";
  }
  useEffect(() => {
    void windowed.start;
    if (!virtualize || !grid.current || typeof ResizeObserver === "undefined")
      return;
    const row = grid.current.querySelector("[data-table-row]");
    if (!row) return;
    const measure = () => {
      const height = row.getBoundingClientRect().height;
      if (height > 0) setMeasuredRowHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [virtualize, windowed.start, windowed.items.length]);
  function goToPage(page) {
    const next = Math.min(pagination.pageCount, Math.max(1, page));
    setLocalPage(next);
    setActive({ row: 0, column: 0 });
    reportPage(next);
  }
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "div",
    {
      "data-data-table": true,
      className: `grid gap-[var(--reddb-spatial-layout-gap-sm)] text-foreground ${containerClass}`.trim(),
      children: [
        filterableColumns.length > 0 || columnVisibility || actions ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
          "div",
          {
            className: "flex flex-wrap items-end gap-[var(--reddb-spatial-layout-gap-sm)]",
            "data-table-tools": true,
            children: [
              filterableColumns.map((column, index) => {
                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                  "label",
                  {
                    className: "grid gap-[var(--reddb-spatial-gap-sm)] text-sm font-medium",
                    children: [
                      /* @__PURE__ */ jsxs("span", { children: [
                        "Filter ",
                        column.header
                      ] }),
                      /* @__PURE__ */ jsx(
                        Input,
                        {
                          type: "search",
                          "aria-label": `Filter ${column.header}`,
                          placeholder: column.filterPlaceholder,
                          value: activeFilters[column.key] ?? "",
                          onInput: (event) => setFilters(column.key, event.currentTarget.value)
                        }
                      )
                    ]
                  }
                ) }, column.key);
              }),
              columnVisibility ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
                "details",
                {
                  className: "relative text-sm [&:not([open])>fieldset]:hidden",
                  "data-column-visibility": true,
                  children: [
                    /* @__PURE__ */ jsx(
                      "summary",
                      {
                        className: "inline-flex h-[var(--reddb-spatial-control-height-md)] cursor-pointer list-none items-center rounded-md border border-control-edge px-[var(--reddb-spatial-inset-md)] text-foreground hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                        children: "Column visibility"
                      }
                    ),
                    /* @__PURE__ */ jsxs(
                      "fieldset",
                      {
                        className: "absolute z-10 grid min-w-max gap-[var(--reddb-spatial-gap-sm)] rounded-md border border-elevation-overlay-border bg-elevation-overlay-surface p-[var(--reddb-spatial-inset-sm)] text-elevation-overlay-foreground shadow-elevation-overlay",
                        children: [
                          /* @__PURE__ */ jsx("legend", { className: "sr-only", children: "Visible columns" }),
                          columns.map((column, index) => {
                            return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                              Checkbox,
                              {
                                label: column.header,
                                "aria-label": `Show ${column.header} column`,
                                checked: visibility[column.key] !== false,
                                disabled: visibility[column.key] !== false && visibleColumns.length === 1,
                                onCheckedChange: () => toggleColumn(column.key)
                              }
                            ) }, column.key);
                          })
                        ]
                      }
                    )
                  ]
                }
              ) }) : null,
              actions ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                "div",
                {
                  "data-table-actions": true,
                  role: "group",
                  "aria-label": `${caption} actions`,
                  className: "ms-auto flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
                  children: actions({
                    rows: sortedRows,
                    pageRows: pagination.rows,
                    selectedRow,
                    changes: activeChanges,
                    filters: activeFilters,
                    sort: activeSort
                  })
                }
              ) }) : null
            ]
          }
        ) }) : null,
        /* @__PURE__ */ jsx(
          "div",
          {
            "data-table-scroll": true,
            "data-row-height": virtualize ? measuredRowHeight : void 0,
            role: "region",
            "aria-label": `${caption} data`,
            tabIndex: 0,
            className: `max-w-full overflow-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${virtualize ? "relative" : ""}`.trim(),
            onScroll: (event) => setScrollTop(event.currentTarget.scrollTop),
            style: {
              maxHeight: virtualize ? `${virtualize.viewportHeight}px` : void 0
            },
            children: /* @__PURE__ */ jsxs(
              "table",
              {
                ref: grid,
                role: "grid",
                "aria-rowcount": pagination.rows.length + 1,
                "aria-colcount": visibleColumns.length,
                className: `w-full min-w-max border-collapse text-left text-sm ${className}`.trim(),
                "data-table": true,
                children: [
                  /* @__PURE__ */ jsx(
                    "caption",
                    {
                      className: captionHidden ? "sr-only" : "caption-top px-[var(--reddb-spatial-inset-md)] pb-[var(--reddb-spatial-inset-sm)] text-left font-medium",
                      children: caption
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    "thead",
                    {
                      className: "sticky top-0 z-10 border-b border-muted bg-background",
                      children: /* @__PURE__ */ jsx("tr", { children: visibleColumns.map((column, index) => {
                        return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                          "th",
                          {
                            scope: "col",
                            "aria-sort": sortValue(column),
                            "data-align": column.align ?? "start",
                            className: `px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-sm)] align-middle font-medium ${alignClass(column)}`.trim(),
                            children: column.sortable ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                              "button",
                              {
                                type: "button",
                                className: quietControl({
                                  ink: "inherit",
                                  class: "-mx-[var(--reddb-spatial-gap-sm)] inline-flex min-h-[var(--reddb-spatial-control-height-sm)] items-center rounded-sm px-[var(--reddb-spatial-gap-sm)]"
                                }),
                                onClick: () => toggleSort(column),
                                children: column.header
                              }
                            ) }) : /* @__PURE__ */ jsx(Fragment, { children: column.header })
                          }
                        ) }, column.key);
                      }) })
                    }
                  ),
                  /* @__PURE__ */ jsxs("tbody", { children: [
                    windowed.offsetTop > 0 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("tr", { "aria-hidden": "true", children: /* @__PURE__ */ jsx(
                      "td",
                      {
                        colSpan: visibleColumns.length,
                        style: { height: `${windowed.offsetTop}px` }
                      }
                    ) }) }) : null,
                    windowed.items.length ? windowed.items.map((row, rowPosition) => {
                      const dataIndex = pagination.start + windowed.start + rowPosition;
                      const rowKeyValue = keyFor(row, dataIndex);
                      const rowSelected = selectable && selectedRow !== null && selectedRow === rowKeyValue;
                      return /* @__PURE__ */ jsx(
                        Fragment2,
                        {
                          children: /* @__PURE__ */ jsx(
                            "tr",
                            {
                              "data-table-row": true,
                              "data-table-row-selected": rowSelected ? "" : void 0,
                              "aria-rowindex": dataIndex + 2,
                              "aria-selected": selectable ? rowSelected : void 0,
                              className: `border-b border-muted ${selectable ? "cursor-pointer" : ""} ${rowSelected ? "bg-foreground/10 font-medium" : selectable ? "hover:bg-foreground/8" : ""}`.trim(),
                              children: visibleColumns.map((column, columnPosition) => {
                                const original = row[column.key];
                                const value = valueWithChanges(
                                  original,
                                  activeChanges,
                                  rowKeyValue,
                                  column.key
                                );
                                return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                                  "td",
                                  {
                                    "data-table-cell": true,
                                    "data-cell-row": rowPosition,
                                    "data-cell-column": columnPosition,
                                    "aria-colindex": columnPosition + 1,
                                    "aria-readonly": !canEdit(row, column),
                                    "data-align": column.align ?? "start",
                                    tabIndex: active.row === rowPosition && active.column === columnPosition ? 0 : -1,
                                    className: `px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-sm)] align-middle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${alignClass(column)}`.trim(),
                                    onClick: (event) => {
                                      setActive({
                                        row: rowPosition,
                                        column: columnPosition
                                      });
                                      event.currentTarget.focus();
                                      if (!canEdit(row, column))
                                        selectRow(row, rowPosition);
                                    },
                                    onDoubleClick: () => beginEdit(
                                      row,
                                      rowPosition,
                                      column,
                                      columnPosition,
                                      value
                                    ),
                                    onKeyDown: (event) => handleCellKeydown(
                                      event,
                                      row,
                                      rowPosition,
                                      column,
                                      columnPosition,
                                      value
                                    ),
                                    children: editing?.rowKey === rowKeyValue && editing.columnKey === column.key ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                                      Input,
                                      {
                                        ref: editor,
                                        onClick: (event) => event.stopPropagation(),
                                        "data-table-editor": true,
                                        "aria-label": `Edit ${column.header} for row ${dataIndex + 1}`,
                                        value: editing.input,
                                        onInput: (event) => {
                                          if (editingSession.current)
                                            setEditing({
                                              ...editingSession.current,
                                              input: event.currentTarget.value
                                            });
                                        },
                                        onKeyDown: handleEditorKeydown,
                                        onBlur: () => finishEdit(true, false),
                                        className: "h-[var(--reddb-spatial-control-height-sm)] w-full px-[var(--reddb-spatial-inset-sm)]"
                                      }
                                    ) }) : /* @__PURE__ */ jsx(Fragment, { children: hasChange(rowKeyValue, column.key) ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("span", { "data-table-pending": true, children: textFor(column, value, row) }) }) : /* @__PURE__ */ jsx(Fragment, { children: cell ? /* @__PURE__ */ jsx(Fragment, { children: cell({
                                      row,
                                      column,
                                      value,
                                      text: textFor(column, value, row)
                                    }) }) : /* @__PURE__ */ jsx(Fragment, { children: textFor(column, value, row) }) }) })
                                  }
                                ) }, column.key);
                              })
                            }
                          )
                        },
                        keyFor(
                          row,
                          pagination.start + windowed.start + rowPosition
                        )
                      );
                    }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx(
                      "td",
                      {
                        colSpan: visibleColumns.length,
                        "data-table-empty": true,
                        className: "px-[var(--reddb-spatial-inset-md)] py-[var(--reddb-spatial-inset-md)] text-center text-ink-muted",
                        children: empty ? /* @__PURE__ */ jsx(Fragment, { children: empty }) : /* @__PURE__ */ jsx(Fragment, { children: emptyMessage })
                      }
                    ) }) }),
                    windowed.offsetBottom > 0 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("tr", { "aria-hidden": "true", children: /* @__PURE__ */ jsx(
                      "td",
                      {
                        colSpan: visibleColumns.length,
                        style: { height: `${windowed.offsetBottom}px` }
                      }
                    ) }) }) : null
                  ] })
                ]
              }
            )
          }
        ),
        pagination.pageCount > 1 ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
          "nav",
          {
            "aria-label": `${caption} pages`,
            className: "flex items-center justify-end gap-[var(--reddb-spatial-gap-md)] text-sm",
            children: [
              /* @__PURE__ */ jsx(
                Button,
                {
                  variant: "secondary",
                  size: "sm",
                  disabled: pagination.page === 1,
                  onClick: () => goToPage(pagination.page - 1),
                  children: "Previous"
                }
              ),
              /* @__PURE__ */ jsxs("span", { "aria-live": "polite", children: [
                "Page ",
                pagination.page,
                " of ",
                pagination.pageCount
              ] }),
              /* @__PURE__ */ jsx(
                Button,
                {
                  variant: "secondary",
                  size: "sm",
                  disabled: pagination.page === pagination.pageCount,
                  onClick: () => goToPage(pagination.page + 1),
                  children: "Next"
                }
              )
            ]
          }
        ) }) : null
      ]
    }
  ) });
}
var Table_default = Table;
export {
  Table,
  Table_default as default
};
