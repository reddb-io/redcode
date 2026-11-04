import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Button, Input, quietControl } from "@reddb-io/design-system/base";
import { Table } from "./Table.js";
import {
  filterVectorRows,
  compactValue,
  scalarLabel,
  vectorMagnitude,
  vectorSearchRequest,
  vectorCoordinatePercent
} from "../../src/vector-explorer.js";
import { explorerClasses as styles } from "../../src/diff-explorer.variants.js";
function VectorExplorer({
  label,
  rows,
  context,
  searchResults,
  onsearch,
  className = ""
}) {
  const [surface, setSurface] = useState("browse"), [mode, setMode] = useState("metadata"), [kind, setKind] = useState("text"), [text, setText] = useState(""), [vector, setVector] = useState(""), [limit, setLimit] = useState(20), [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(null), [response, setResponse] = useState(), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const filterInput = useRef(null), controller = useRef(void 0);
  useEffect(() => {
    controller.current?.abort();
    setResponse(void 0);
    setBusy(false);
    setError(null);
    setSelected(null);
    return () => controller.current?.abort();
  }, [context, rows]);
  const incoming = response ?? searchResults, visible = filterVectorRows(
    surface === "search" ? incoming?.rows ?? [] : rows,
    filter
  ), active = visible.find((row) => row.index === selected) ?? visible[0];
  const scoreRows = visible.map((row) => ({
    index: row.index,
    id: row.id,
    score: row.scalar === null ? "n/a" : row.scalar.toFixed(6),
    metric: scalarLabel(row),
    magnitude: vectorMagnitude(row.vector).toFixed(6)
  }));
  const columns = [
    { key: "id", header: "id" },
    { key: "score", header: "ranking metric", align: "end" },
    { key: "metric", header: "metric type" },
    { key: "magnitude", header: "magnitude", align: "end" }
  ];
  async function search() {
    if (!onsearch) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setError(null);
    setBusy(true);
    try {
      const next = await onsearch(
        vectorSearchRequest(kind, kind === "text" ? text : vector, limit),
        task.signal
      );
      if (task.signal.aborted) return;
      setResponse(next);
      setSelected(null);
      setMode("metadata");
    } catch (cause) {
      if (!task.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === task && !task.signal.aborted) setBusy(false);
    }
  }
  const toggle = (value, current, change) => /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      className: quietControl({
        selected: current === value,
        class: "px-[var(--reddb-spatial-inset-sm)]"
      }),
      "aria-pressed": current === value,
      onClick: () => change(value),
      children: value
    },
    value
  );
  return /* @__PURE__ */ jsxs(
    "section",
    {
      "data-vector-explorer": true,
      "aria-label": label,
      className: `@container ${styles.root} ${className}`,
      children: [
        /* @__PURE__ */ jsxs("div", { className: styles.toolbar, children: [
          ["browse", "search"].map(
            (view) => toggle(view, surface, (value) => {
              setSurface(value);
              setSelected(null);
            })
          ),
          /* @__PURE__ */ jsxs("span", { children: [
            rows.find((row) => row.dimension > 0)?.dimension ?? 0,
            "d",
            context ? ` \xB7 ${context}` : ""
          ] })
        ] }),
        surface === "search" && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs(
            "form",
            {
              className: styles.toolbar,
              onSubmit: (e) => {
                e.preventDefault();
                void search();
              },
              children: [
                ["text", "vector"].map(
                  (source) => toggle(source, kind, (value) => setKind(value))
                ),
                kind === "text" ? /* @__PURE__ */ jsxs("label", { children: [
                  "Search text",
                  " ",
                  /* @__PURE__ */ jsx(
                    Input,
                    {
                      "aria-label": "Search text",
                      value: text,
                      onChange: (e) => setText(e.currentTarget.value)
                    }
                  )
                ] }) : /* @__PURE__ */ jsxs("label", { children: [
                  "Query vector",
                  " ",
                  /* @__PURE__ */ jsx(
                    Input,
                    {
                      "aria-label": "Query vector",
                      value: vector,
                      onChange: (e) => setVector(e.currentTarget.value)
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxs("label", { children: [
                  "Limit",
                  " ",
                  /* @__PURE__ */ jsx(
                    Input,
                    {
                      "aria-label": "Limit",
                      type: "number",
                      min: "1",
                      max: "200",
                      value: limit,
                      onChange: (e) => setLimit(Number(e.currentTarget.value))
                    }
                  )
                ] }),
                /* @__PURE__ */ jsx(Button, { type: "submit", disabled: busy || !onsearch, children: busy ? "Searching\u2026" : "Run search" }),
                busy && /* @__PURE__ */ jsx(
                  Button,
                  {
                    onClick: () => {
                      controller.current?.abort();
                      setBusy(false);
                    },
                    children: "Cancel search"
                  }
                ),
                !onsearch && /* @__PURE__ */ jsx("p", { children: "Search is not available for this dataset." })
              ]
            }
          ),
          error && /* @__PURE__ */ jsx("p", { role: "alert", className: styles.detail, children: error }),
          incoming?.note && /* @__PURE__ */ jsx("p", { className: styles.detail, children: incoming.note })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: styles.toolbar, children: [
          ["metadata", "vector", "scores"].map(
            (view) => toggle(view, mode, setMode)
          ),
          /* @__PURE__ */ jsxs("label", { children: [
            "Filter vectors",
            " ",
            /* @__PURE__ */ jsx(
              Input,
              {
                type: "search",
                "aria-label": "Filter vectors",
                value: filter,
                onChange: (e) => setFilter(e.currentTarget.value),
                ref: filterInput
              }
            )
          ] }),
          filter && /* @__PURE__ */ jsx(
            Button,
            {
              onClick: () => {
                setFilter("");
                filterInput.current?.focus();
              },
              children: "Clear filter"
            }
          ),
          /* @__PURE__ */ jsxs("span", { children: [
            visible.length,
            " rows"
          ] })
        ] }),
        !visible.length ? /* @__PURE__ */ jsx("p", { className: styles.detail, children: filter ? "No vectors match the filter." : surface === "search" && !incoming ? "No vector search has been run." : "No vector rows returned." }) : mode === "scores" ? /* @__PURE__ */ jsx(
          Table,
          {
            caption: "Vector scores",
            captionHidden: true,
            columns,
            rows: scoreRows,
            rowKey: "index",
            pageSize: 80,
            columnVisibility: false
          }
        ) : /* @__PURE__ */ jsxs("div", { className: styles.content, children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              role: "region",
              "aria-label": "Vectors",
              tabIndex: 0,
              className: styles.list,
              children: visible.map((row) => /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  className: quietControl({
                    selected: active?.index === row.index,
                    focus: "inset",
                    class: styles.row
                  }),
                  "aria-pressed": active?.index === row.index,
                  onClick: () => setSelected(row.index),
                  children: [
                    /* @__PURE__ */ jsx("span", { children: row.id }),
                    /* @__PURE__ */ jsxs("span", { children: [
                      row.dimension,
                      "d"
                    ] }),
                    /* @__PURE__ */ jsx("span", { children: Object.entries(row.metadata).slice(0, 3).map(([key, value]) => `${key}=${compactValue(value)}`).join(" \xB7 ") })
                  ]
                },
                row.index
              ))
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              role: "region",
              "aria-label": "Vector details",
              tabIndex: 0,
              className: styles.detail,
              children: active && /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsxs("p", { children: [
                  active.id,
                  " \xB7 ",
                  active.dimension,
                  "d \xB7 magnitude",
                  " ",
                  active.vector.length ? vectorMagnitude(active.vector).toFixed(6) : "n/a"
                ] }),
                mode === "metadata" ? /* @__PURE__ */ jsxs(Fragment, { children: [
                  /* @__PURE__ */ jsxs("p", { children: [
                    "coordinates:",
                    " ",
                    active.vector.length ? "returned" : "not returned",
                    active.vectorColumn ? ` \xB7 ${active.vectorColumn}` : ""
                  ] }),
                  active.scalarColumn && /* @__PURE__ */ jsxs("p", { children: [
                    scalarLabel(active),
                    ": ",
                    active.scalar ?? "n/a"
                  ] }),
                  /* @__PURE__ */ jsx("dl", { children: Object.entries(active.metadata).map(([key, value]) => /* @__PURE__ */ jsxs("div", { children: [
                    /* @__PURE__ */ jsx("dt", { className: "text-ink-muted", children: key }),
                    /* @__PURE__ */ jsx("dd", { className: styles.value, children: compactValue(value) })
                  ] }, key)) })
                ] }) : !active.vector.length ? /* @__PURE__ */ jsxs("p", { children: [
                  "This result reports a ",
                  active.dimension,
                  "d vector, but the coordinate array was not returned."
                ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
                  /* @__PURE__ */ jsxs("p", { children: [
                    active.vector.length,
                    " dimensions"
                  ] }),
                  active.vector.slice(0, 256).map((value, index) => /* @__PURE__ */ jsxs(
                    "div",
                    {
                      className: "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[var(--reddb-spatial-gap-md)]",
                      children: [
                        /* @__PURE__ */ jsx("span", { children: index }),
                        /* @__PURE__ */ jsx(
                          "div",
                          {
                            role: "meter",
                            className: styles.coordinateTrack,
                            "aria-valuemin": 0,
                            "aria-valuemax": 100,
                            "aria-valuenow": vectorCoordinatePercent(
                              value,
                              active.vector
                            ),
                            "aria-label": `Coordinate ${index} magnitude`,
                            children: /* @__PURE__ */ jsx(
                              "div",
                              {
                                className: styles.coordinateBar,
                                style: {
                                  width: `${vectorCoordinatePercent(value, active.vector)}%`
                                }
                              }
                            )
                          }
                        ),
                        /* @__PURE__ */ jsx("span", { children: value.toFixed(5) })
                      ]
                    },
                    index
                  )),
                  active.vector.length > 256 && /* @__PURE__ */ jsx("p", { children: "Showing first 256 dimensions." }),
                  /* @__PURE__ */ jsxs("details", { children: [
                    /* @__PURE__ */ jsx("summary", { children: "Full coordinates" }),
                    /* @__PURE__ */ jsx("pre", { className: styles.value, children: JSON.stringify(active.vector) })
                  ] })
                ] })
              ] })
            }
          )
        ] })
      ]
    }
  );
}
var VectorExplorer_default = VectorExplorer;
export {
  VectorExplorer,
  VectorExplorer_default as default
};
