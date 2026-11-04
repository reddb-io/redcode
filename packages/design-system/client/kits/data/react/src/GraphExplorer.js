import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  Textarea,
  Checkbox,
  Link,
  EmptyState,
  StateIllustration,
  quietControl
} from "@reddb-io/design-system/base";
import {
  graphEmptyCompact,
  searchEmpty
} from "@reddb-io/design-system/base/illustrations";
import { Graph } from "./Graph.js";
import { Table } from "./Table.js";
import {
  shapeGraphData,
  detectGraphCommunities
} from "../../src/graph.js";
import {
  filterExplorerGraph,
  explorerGraphData,
  graphExplorerTypes,
  graphExplorerNodeType,
  graphNodeDetail,
  graphNodeCentrality
} from "../../src/graph-explorer.js";
import { explorerClasses as styles } from "../../src/diff-explorer.variants.js";
function GraphExplorer({
  label,
  data,
  context,
  error,
  emptyReason = "empty",
  recoveryHref,
  recoveryLabel = "Inspect data",
  initialView = "canvas",
  onquery,
  nodehref,
  className = ""
}) {
  const [view, setView] = useState(initialView), [filter, setFilter] = useState(""), [hidden, setHidden] = useState(/* @__PURE__ */ new Set()), [limit, setLimit] = useState(25e3), [budget, setBudget] = useState(350), [grouped, setGrouped] = useState(false), [bundled, setBundled] = useState(false), [collapsed, setCollapsed] = useState([]);
  const [selected, setSelected] = useState(null), [focus, setFocus] = useState(null), [override, setOverride] = useState(null), [queryOpen, setQueryOpen] = useState(false), [draft, setDraft] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [busy, setBusy] = useState(false), [failure, setFailure] = useState(null);
  const input = useRef(null), controller = useRef(void 0);
  useEffect(() => {
    controller.current?.abort();
    setOverride(null);
    setSelected(null);
    setFocus(null);
    setFailure(null);
    setBusy(false);
    setCollapsed([]);
    return () => controller.current?.abort();
  }, [data, context]);
  const active = override ?? data, types = useMemo(() => graphExplorerTypes(active), [active]), filtered = useMemo(
    () => filterExplorerGraph(active, filter, hidden, limit),
    [active, filter, hidden, limit]
  );
  useEffect(() => {
    const count = filtered.nodes.length;
    let frame = 0, current = Math.min(350, count), disposed = false;
    setBudget(current);
    function grow() {
      if (disposed) return;
      current = Math.min(current + 400, count);
      setBudget(current);
      if (current < count) frame = requestAnimationFrame(grow);
    }
    if (current < count) frame = requestAnimationFrame(grow);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [filtered]);
  const drawing = useMemo(
    () => filterExplorerGraph(filtered, "", /* @__PURE__ */ new Set(), budget),
    [filtered, budget]
  );
  const canonical = useMemo(
    () => detectGraphCommunities(shapeGraphData(explorerGraphData(drawing))),
    [drawing]
  );
  const graphData = useMemo(
    () => ({
      nodes: canonical.nodes.map((node2) => ({
        ...node2,
        community: node2.community
      })),
      edges: canonical.edges
    }),
    [canonical]
  );
  const communities = [
    ...new Set(canonical.nodes.map((node2) => node2.community))
  ];
  const node = selected?.kind === "node" ? filtered.nodes.find((node2) => node2.id === selected.id) : void 0, edge = selected?.kind === "edge" ? filtered.edges.find((edge2) => edge2.id === selected.id) : void 0;
  const selectedCommunity = canonical.nodes.find((entry) => entry.id === node?.id)?.community;
  const canCollapse = selectedCommunity !== void 0 && canonical.nodes.filter((entry) => entry.community === selectedCommunity).length > 1;
  const href = node ? nodehref?.(node) : void 0;
  const centrality = useMemo(
    () => graphNodeCentrality(active.nodes, active.edges),
    [active]
  );
  const detail = node ? graphNodeDetail(node, active.nodes, active.edges, centrality) : void 0;
  const tableRows = filtered.nodes.map((node2) => ({
    id: node2.id,
    label: node2.label,
    type: graphExplorerNodeType(node2),
    degree: centrality.get(node2.id)?.degree ?? 0,
    score: centrality.get(node2.id)?.score ?? 0
  }));
  function clear() {
    setFilter("");
    setHidden(/* @__PURE__ */ new Set());
    input.current?.focus();
  }
  function select(event) {
    setSelected(event);
    if (event.kind === "node") setFocus(event.id);
  }
  async function run(request) {
    if (!onquery || busy) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setFailure(null);
    try {
      const next = await onquery(request, task.signal);
      if (!task.signal.aborted) {
        setOverride(next);
        setSelected(null);
        setFocus(null);
        setCollapsed([]);
      }
    } catch (cause) {
      if (!task.signal.aborted)
        setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === task && !task.signal.aborted) setBusy(false);
    }
  }
  function reset() {
    controller.current?.abort();
    setOverride(null);
    setSelected(null);
    setFocus(null);
    setFailure(null);
    setBusy(false);
    setCollapsed([]);
    setDraft("");
  }
  return /* @__PURE__ */ jsx(
    "section",
    {
      "data-graph-explorer": true,
      "aria-label": label,
      className: `@container ${styles.root} ${className}`,
      children: error ? /* @__PURE__ */ jsx("p", { role: "alert", className: styles.detail, children: error }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        active.summary && /* @__PURE__ */ jsx("p", { role: "status", className: styles.detail, children: active.summary }),
        /* @__PURE__ */ jsxs("div", { className: styles.toolbar, children: [
          ["canvas", "svg", "table"].map((mode) => /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: quietControl({
                selected: view === mode,
                class: "px-[var(--reddb-spatial-inset-sm)]"
              }),
              "aria-pressed": view === mode,
              onClick: () => setView(mode),
              children: mode
            },
            mode
          )),
          /* @__PURE__ */ jsxs("label", { children: [
            "Filter graph",
            " ",
            /* @__PURE__ */ jsx(
              Input,
              {
                "aria-label": "Filter graph",
                value: filter,
                onChange: (e) => setFilter(e.currentTarget.value),
                ref: input
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("label", { children: [
            "Node limit",
            " ",
            /* @__PURE__ */ jsx(
              Input,
              {
                "aria-label": "Node limit",
                type: "number",
                min: "1",
                max: "25000",
                value: limit,
                onChange: (e) => setLimit(Number(e.currentTarget.value))
              }
            )
          ] }),
          (filter || hidden.size > 0) && /* @__PURE__ */ jsx(Button, { onClick: clear, children: "Clear graph filters" }),
          /* @__PURE__ */ jsx(Button, { "aria-pressed": grouped, onClick: () => setGrouped(!grouped), children: "Group communities" }),
          /* @__PURE__ */ jsx(Button, { "aria-pressed": bundled, onClick: () => setBundled(!bundled), children: "Bundle edges" }),
          /* @__PURE__ */ jsx(
            Button,
            {
              "aria-pressed": collapsed.length > 0,
              onClick: () => setCollapsed(collapsed.length ? [] : communities),
              children: collapsed.length ? "Expand communities" : "Collapse communities"
            }
          ),
          onquery && /* @__PURE__ */ jsx(
            Button,
            {
              "aria-pressed": queryOpen,
              onClick: () => setQueryOpen(!queryOpen),
              children: "Query graph"
            }
          ),
          override && /* @__PURE__ */ jsx(Button, { onClick: reset, children: "Reset graph" }),
          /* @__PURE__ */ jsxs("span", { children: [
            filtered.nodes.length,
            " of ",
            active.nodes.length,
            " nodes \xB7",
            " ",
            filtered.edges.length,
            " edges",
            context ? ` \xB7 ${context}` : ""
          ] })
        ] }),
        types.length > 1 && /* @__PURE__ */ jsx("div", { className: styles.toolbar, children: types.map((type) => /* @__PURE__ */ jsx(
          Checkbox,
          {
            label: type,
            checked: !hidden.has(type),
            onCheckedChange: (visible) => {
              const next = new Set(hidden);
              if (visible) next.delete(type);
              else next.add(type);
              setHidden(next);
            }
          },
          type
        )) }),
        queryOpen && onquery && /* @__PURE__ */ jsxs("div", { className: styles.detail, children: [
          /* @__PURE__ */ jsxs(
            "form",
            {
              className: styles.toolbar,
              onSubmit: (event) => {
                event.preventDefault();
                void run({ kind: "query", query: draft });
              },
              children: [
                /* @__PURE__ */ jsxs("label", { children: [
                  "Graph query",
                  " ",
                  /* @__PURE__ */ jsx(
                    Textarea,
                    {
                      "aria-label": "Graph query",
                      value: draft,
                      onChange: (e) => setDraft(e.currentTarget.value)
                    }
                  )
                ] }),
                /* @__PURE__ */ jsx(Button, { type: "submit", disabled: busy || !draft.trim(), children: "Run query" }),
                /* @__PURE__ */ jsx(
                  Button,
                  {
                    disabled: busy || !node,
                    onClick: () => node && run({ kind: "neighborhood", node: node.label }),
                    children: "Neighborhood"
                  }
                ),
                /* @__PURE__ */ jsx(
                  Button,
                  {
                    disabled: busy,
                    onClick: () => run({ kind: "centrality" }),
                    children: "Centrality"
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ jsxs(
            "form",
            {
              className: styles.toolbar,
              onSubmit: (event) => {
                event.preventDefault();
                void run({ kind: "path", from, to });
              },
              children: [
                /* @__PURE__ */ jsxs("label", { children: [
                  "Path from",
                  " ",
                  /* @__PURE__ */ jsx(
                    Input,
                    {
                      "aria-label": "Path from",
                      value: from,
                      onChange: (e) => setFrom(e.currentTarget.value)
                    }
                  )
                ] }),
                /* @__PURE__ */ jsx(
                  Button,
                  {
                    disabled: !node,
                    onClick: () => setFrom(node?.label ?? ""),
                    children: "Use selected as start"
                  }
                ),
                /* @__PURE__ */ jsxs("label", { children: [
                  "Path to",
                  " ",
                  /* @__PURE__ */ jsx(
                    Input,
                    {
                      "aria-label": "Path to",
                      value: to,
                      onChange: (e) => setTo(e.currentTarget.value)
                    }
                  )
                ] }),
                /* @__PURE__ */ jsx(
                  Button,
                  {
                    disabled: !node,
                    onClick: () => setTo(node?.label ?? ""),
                    children: "Use selected as end"
                  }
                ),
                /* @__PURE__ */ jsx(
                  Button,
                  {
                    type: "submit",
                    disabled: busy || !from.trim() || !to.trim(),
                    children: "Shortest path"
                  }
                )
              ]
            }
          ),
          busy && /* @__PURE__ */ jsx(
            Button,
            {
              onClick: () => {
                controller.current?.abort();
                setBusy(false);
              },
              children: "Cancel graph query"
            }
          ),
          failure && /* @__PURE__ */ jsx("p", { role: "alert", children: failure })
        ] }),
        !filtered.nodes.length ? /* @__PURE__ */ jsx(
          "div",
          {
            "data-renderer-empty": "graph",
            "data-empty-reason": active.nodes.length ? "filtered" : emptyReason,
            className: styles.detail,
            children: /* @__PURE__ */ jsx(
              EmptyState,
              {
                title: active.nodes.length ? "No nodes match these filters" : emptyReason === "unsupported" ? "No graph data in this result" : "No graph data returned",
                description: active.nodes.length ? "Clear graph filters to show the returned network." : emptyReason === "unsupported" ? "The returned records do not contain graph nodes. Inspect the source data or run a graph query." : "Run a graph query to inspect its nodes and relationships.",
                bordered: false,
                media: /* @__PURE__ */ jsx(
                  StateIllustration,
                  {
                    art: active.nodes.length ? searchEmpty : graphEmptyCompact,
                    size: "md"
                  }
                ),
                actions: active.nodes.length ? /* @__PURE__ */ jsx(Button, { onClick: clear, children: "Clear graph filters" }) : recoveryHref ? /* @__PURE__ */ jsx(Button, { href: recoveryHref, children: recoveryLabel }) : void 0
              }
            )
          }
        ) : view === "table" ? /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(
            Table,
            {
              caption: label,
              captionHidden: true,
              rows: tableRows,
              columns: [
                { key: "id", header: "id" },
                { key: "label", header: "label" },
                { key: "type", header: "type" },
                { key: "degree", header: "degree" },
                { key: "score", header: "centrality" }
              ],
              rowKey: "id",
              pageSize: 80,
              onSelect: (row) => select({ kind: "node", action: "click", id: String(row) })
            }
          ),
          /* @__PURE__ */ jsx(
            Table,
            {
              caption: `${label} relationships`,
              rows: filtered.edges.map((edge2) => ({
                id: edge2.id,
                source: edge2.source,
                target: edge2.target,
                label: edge2.label ?? ""
              })),
              columns: [
                { key: "source", header: "source" },
                { key: "target", header: "target" },
                { key: "label", header: "relationship" }
              ],
              rowKey: "id",
              pageSize: 80,
              onSelect: (row) => select({ kind: "edge", action: "click", id: String(row) })
            }
          )
        ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(
            Graph,
            {
              searchable: false,
              label,
              data: graphData,
              renderer: view === "svg" ? "svg" : "auto",
              grouped,
              bundled,
              controls: true,
              focusedNode: focus,
              onFocusedNodeChange: setFocus,
              collapsedCommunities: collapsed,
              onCollapsedCommunitiesChange: setCollapsed,
              onInteraction: select
            },
            view + collapsed.join(",")
          ),
          drawing.nodes.length < filtered.nodes.length && /* @__PURE__ */ jsxs("p", { role: "status", className: styles.detail, children: [
            "Drawing ",
            drawing.nodes.length,
            " of ",
            filtered.nodes.length,
            " ",
            "nodes\u2026"
          ] })
        ] }),
        (node || edge) && /* @__PURE__ */ jsxs("aside", { "aria-label": "Graph details", className: styles.detail, children: [
          /* @__PURE__ */ jsxs("div", { className: styles.toolbar, children: [
            /* @__PURE__ */ jsx("strong", { children: node?.label ?? edge?.label ?? edge?.id }),
            /* @__PURE__ */ jsx(
              Button,
              {
                onClick: () => {
                  setSelected(null);
                  setFocus(null);
                },
                children: "Clear selection"
              }
            )
          ] }),
          node && detail ? /* @__PURE__ */ jsxs(Fragment, { children: [
            canCollapse && /* @__PURE__ */ jsx(Button, { onClick: () => {
              setCollapsed([.../* @__PURE__ */ new Set([...collapsed, selectedCommunity])]);
              setSelected(null);
              setFocus(null);
            }, children: "Collapse selected community" }),
            /* @__PURE__ */ jsx("p", { children: detail.description ?? node.id }),
            /* @__PURE__ */ jsxs("p", { children: [
              detail.orphan ? "Orphan node" : "Connected node",
              " \xB7 degree",
              " ",
              centrality.get(node.id)?.degree ?? 0,
              " \xB7 centrality",
              " ",
              centrality.get(node.id)?.score ?? 0
            ] }),
            href && /* @__PURE__ */ jsx(Link, { href, children: "Open node resource" }),
            detail.exports.length > 0 && /* @__PURE__ */ jsxs("p", { children: [
              "Exports: ",
              detail.exports.join(", ")
            ] }),
            /* @__PURE__ */ jsx("div", { className: styles.toolbar, children: [...detail.incoming, ...detail.outgoing].map(
              (relation) => /* @__PURE__ */ jsxs(
                Button,
                {
                  onClick: () => select({
                    kind: "node",
                    action: "click",
                    id: relation.nodeId
                  }),
                  children: [
                    relation.direction,
                    ": ",
                    relation.nodeLabel
                  ]
                },
                relation.id
              )
            ) }),
            /* @__PURE__ */ jsx("pre", { className: styles.value, children: JSON.stringify(node.data, null, 2) })
          ] }) : edge ? /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsxs("p", { children: [
              edge.source,
              " \u2192 ",
              edge.target
            ] }),
            /* @__PURE__ */ jsx("pre", { className: styles.value, children: JSON.stringify(edge.data ?? {}, null, 2) })
          ] }) : null
        ] })
      ] })
    }
  );
}
var GraphExplorer_default = GraphExplorer;
export {
  GraphExplorer,
  GraphExplorer_default as default
};
