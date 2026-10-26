"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import {
  Fragment as Fragment2,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Input, ToggleButton } from "@reddb-io/design-system/base";
import {
  applyGraphLevelOfDetail,
  collapseGraphCommunities,
  detectGraphCommunities,
  groupGraphCommunities,
  layoutGraphBySparseStress,
  reduceGraphFocus,
  searchGraphNodes,
  shapeGraphData
} from "../../src/graph.js";
import {
  GRAPH_COLOR_TOKENS,
  GRAPH_EDGE_LABEL_MAX_LENGTH,
  GRAPH_EDGE_COLOR_TOKEN,
  GRAPH_FOCUSED_SCALE,
  GRAPH_FOCUS_PULSE_SCALE,
  GRAPH_ENGINE_STAGE_PADDING,
  GRAPH_LAYOUT_GRAVITY,
  GRAPH_LAYOUT_ITERATIONS_PER_NODE,
  GRAPH_LAYOUT_MAX_ITERATIONS,
  GRAPH_LAYOUT_MIN_AXIS_FILL,
  GRAPH_LAYOUT_MIN_ITERATIONS,
  GRAPH_LAYOUT_SCALING_RATIO,
  GRAPH_MUTED_COLOR_TOKEN,
  GRAPH_NEIGHBOUR_LABEL_LIMIT,
  GRAPH_NEIGHBOUR_SCALE,
  GRAPH_REST_SCALE,
  GRAPH_SUPERNODE_BASE_SIZE,
  GRAPH_SUPERNODE_MEMBER_SCALE,
  analyseGraphStructure,
  applyGraphLevelOfDetail as applyGraphLevelOfDetail2,
  collapseGraphCommunities as collapseGraphCommunities2,
  countGraphEdgeCrossings,
  countGraphNodeOverlapRatio,
  deriveGraphLevelOfDetail,
  detectGraphCommunities as detectGraphCommunities2,
  filterGraphBackbone,
  graphNormalizedStress,
  groupGraphCommunities as groupGraphCommunities2,
  layoutGraphByCentrality,
  layoutGraphBySparseStress as layoutGraphBySparseStress2,
  partitionGraphByCentrality,
  rankGraphByBetweenness,
  reduceGraphFocus as reduceGraphFocus2,
  searchGraphNodes as searchGraphNodes2,
  shapeGraphData as shapeGraphData2
} from "../../src/graph.js";
function Graph(props) {
  const {
    data,
    label = "Network graph",
    width = 640,
    height = 400,
    renderer = "auto",
    searchable = true,
    focusedNode,
    onFocusedNodeChange,
    collapsedCommunities = [],
    onCollapsedCommunitiesChange,
    layout = "stress",
    layoutSeed = 0,
    hubCount,
    onInteraction,
    showDetails = false,
    className = ""
  } = props;
  const [query, setQuery] = useState(""), [localFocus, setLocalFocus] = useState(null), [engineState, setEngineState] = useState(
    "loading"
  ), [controller, setController] = useState(), [reducedMotion, setReducedMotion] = useState(false), [nodeMargin, setNodeMargin] = useState(4), [localCollapsedCommunities, setLocalCollapsedCommunities] = useState(
    () => new Set(collapsedCommunities)
  ), [localExpandedSubtrees, setLocalExpandedSubtrees] = useState(
    /* @__PURE__ */ new Set()
  ), [selectedInteraction, setSelectedInteraction] = useState();
  const engineHost = useRef(null), graphRoot = useRef(null), densityProbe = useRef(null);
  const GRAPH_FOCUS_OUTLINE = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
  const shaped = useMemo(() => shapeGraphData(data), [data]);
  const detected = useMemo(
    () => detectGraphCommunities(shaped, { seed: layoutSeed }),
    [shaped, layoutSeed]
  );
  const communities = useMemo(
    () => groupGraphCommunities(detected.nodes),
    [detected]
  );
  const collapsed = useMemo(
    () => collapseGraphCommunities(detected, localCollapsedCommunities),
    [detected, localCollapsedCommunities]
  );
  const arrangement = useMemo(
    () => layoutGraphBySparseStress(collapsed, {
      seed: layoutSeed,
      hubCount,
      viewport: { width, height, padding: 40, nodeMargin },
      nodeMargin
    }),
    [collapsed, layoutSeed, hubCount, width, height, nodeMargin]
  );
  const detail = useMemo(
    () => applyGraphLevelOfDetail(arrangement.data, arrangement.parentByNode, {
      width,
      height,
      padding: 40,
      expandedSubtrees: localExpandedSubtrees
    }),
    [arrangement, width, height, localExpandedSubtrees]
  );
  const visible = useMemo(() => detail.data, [detail]);
  const results = useMemo(
    () => searchGraphNodes(visible.nodes, query),
    [visible, query]
  );
  const activeFocus = focusedNode === void 0 ? localFocus : focusedNode;
  const focused = useMemo(
    () => reduceGraphFocus(visible, activeFocus ?? null, 0, {
      width,
      height,
      padding: 40,
      nodeMargin
    }),
    [visible, activeFocus, width, height, nodeMargin]
  );
  function nodeById(id) {
    return visible.nodes.find((node) => node.id === id);
  }
  function svgX(node) {
    return (node.x + 1) / 2 * (width - 80) + 40;
  }
  function svgY(node) {
    return (node.y + 1) / 2 * (height - 80) + 40;
  }
  function labelBox(text, x, y) {
    const labelWidth = Math.max(16, text.length * 7.5);
    return {
      left: x - labelWidth / 2,
      right: x + labelWidth / 2,
      top: y - 12,
      bottom: y + 4
    };
  }
  function boxesOverlap(left, right) {
    return left.left < right.right + 2 && left.right > right.left - 2 && left.top < right.bottom + 2 && left.bottom > right.top - 2;
  }
  const svgLabels = useMemo(
    () => (() => {
      const circles = focused.nodes.map((node) => ({
        x: svgX(node),
        y: svgY(node),
        radius: node.size * node.scale + 3
      }));
      const occupied = [];
      const labels = [];
      const fits = (box) => {
        if (box.left < 4 || box.right > width - 4 || box.top < 4 || box.bottom > height - 4) {
          return false;
        }
        if (occupied.some((other) => boxesOverlap(box, other))) return false;
        return circles.every((circle) => {
          const nearestX = Math.max(box.left, Math.min(circle.x, box.right));
          const nearestY = Math.max(box.top, Math.min(circle.y, box.bottom));
          return Math.hypot(circle.x - nearestX, circle.y - nearestY) > circle.radius + 2;
        });
      };
      const accept = (key, text, candidates, identity, required = false) => {
        let placement = candidates.map(({ x, y }) => ({ x, y, box: labelBox(text, x, y) })).find(({ box }) => fits(box));
        if (!placement && required) {
          const labelWidth = Math.max(16, text.length * 7.5);
          for (let y = 18; y <= height - 8 && !placement; y += 18) {
            for (let x = labelWidth / 2 + 6; x <= width - labelWidth / 2 - 6; x += 18) {
              const box = labelBox(text, x, y);
              if (fits(box)) placement = { x, y, box };
            }
          }
        }
        if (!placement) return;
        occupied.push(placement.box);
        labels.push({ key, text, ...placement, ...identity });
      };
      const degrees = new Map(visible.nodes.map((node) => [node.id, 0]));
      for (const edge of visible.edges) {
        degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
        degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
      }
      const nodePriority = focused.nodes.filter((node) => node.showLabel).map((node, index) => ({ node, index })).sort((left, right) => {
        if (left.node.id === activeFocus) return -1;
        if (right.node.id === activeFocus) return 1;
        const byTrunkRank = (left.node.trunkRank ?? Number.POSITIVE_INFINITY) - (right.node.trunkRank ?? Number.POSITIVE_INFINITY);
        if (byTrunkRank !== 0) return byTrunkRank;
        return (degrees.get(right.node.id) ?? 0) - (degrees.get(left.node.id) ?? 0) || left.index - right.index;
      });
      for (const { node } of nodePriority) {
        const x = svgX(node);
        const y = svgY(node);
        const radius = node.size * node.scale + 3;
        const labelWidth = Math.max(16, node.label.length * 7.5);
        const candidates = [
          { x, y: y + radius + 16 },
          { x, y: y - radius - 8 },
          { x: x + radius + 8 + labelWidth / 2, y: y + 4 },
          { x: x - radius - 8 - labelWidth / 2, y: y + 4 },
          { x: x + radius + 8 + labelWidth / 2, y: y + radius + 12 },
          { x: x - radius - 8 - labelWidth / 2, y: y + radius + 12 },
          { x: x + radius + 8 + labelWidth / 2, y: y - radius - 4 },
          { x: x - radius - 8 - labelWidth / 2, y: y - radius - 4 }
        ];
        accept(
          `node:${node.id}`,
          node.label,
          candidates,
          { nodeId: node.id },
          node.id === activeFocus
        );
      }
      for (const edge of focused.edges) {
        if (!edge.displayLabel) continue;
        const source = nodeById(edge.source);
        const target = nodeById(edge.target);
        const sourceX = svgX(source);
        const sourceY = svgY(source);
        const targetX = svgX(target);
        const targetY = svgY(target);
        const length = Math.max(
          1,
          Math.hypot(targetX - sourceX, targetY - sourceY)
        );
        const normalX = -(targetY - sourceY) / length;
        const normalY = (targetX - sourceX) / length;
        const candidates = [0.5, 0.35, 0.65, 0.2, 0.8].flatMap(
          (progress) => [0, 18, -18, 32, -32].map((offset) => ({
            x: sourceX + (targetX - sourceX) * progress + normalX * offset,
            y: sourceY + (targetY - sourceY) * progress + normalY * offset + 4
          }))
        );
        accept(`edge:${edge.id}`, edge.displayLabel, candidates, {
          edgeId: edge.id
        });
      }
      return labels;
    })(),
    [focused, visible, activeFocus, width, height]
  );
  function interaction(kind, action, id) {
    const item = kind === "node" ? visible.nodes.find((node) => node.id === id) : visible.edges.find((edge) => edge.id === id);
    if (!item) return;
    const event = {
      kind,
      action,
      id,
      ...item.metadata === void 0 ? {} : { metadata: item.metadata }
    };
    setSelectedInteraction(event);
    onInteraction?.(event);
  }
  function expandCommunity(community) {
    const next = new Set(localCollapsedCommunities);
    next.delete(community);
    setLocalCollapsedCommunities(next);
    onCollapsedCommunitiesChange?.([...next]);
  }
  function expandSubtree(subtree) {
    const next = new Set(localExpandedSubtrees);
    next.add(subtree);
    setLocalExpandedSubtrees(next);
  }
  function focus(id) {
    setLocalFocus(id);
    controller?.focusNode(id);
    onFocusedNodeChange?.(id);
    if (id !== null && !reducedMotion) void pulseSvgNode(id);
  }
  async function pulseSvgNode(id) {
    await Promise.resolve();
    const node = [
      ...graphRoot.current.querySelectorAll(
        "[data-node-id]"
      )
    ].find((circle) => circle.dataset.nodeId === id);
    node?.animate?.(
      [{ strokeWidth: "3" }, { strokeWidth: "5" }, { strokeWidth: "3" }],
      { duration: 420, easing: "ease-out" }
    );
  }
  function handleNodeClick(event, id) {
    event.stopPropagation();
    interaction("node", "click", id);
    const node = nodeById(id);
    if (node.collapsedSubtree) {
      expandSubtree(node.collapsedSubtree);
      return;
    }
    if (node.collapsedCommunity) {
      expandCommunity(node.collapsedCommunity);
      return;
    }
    focus(id);
  }
  function handleNodeFocus(id) {
    interaction("node", "focus", id);
  }
  function handleNodeKeydown(event, id) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handleNodeClick(event, id);
  }
  function handleEdgeClick(event, id) {
    event.stopPropagation();
    interaction("edge", "click", id);
  }
  function handleEdgeKeydown(event, id) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    interaction("edge", "click", id);
  }
  const latest = useRef({
    visible,
    activeFocus,
    layout,
    interaction,
    nodeById,
    expandSubtree,
    expandCommunity,
    focus
  });
  latest.current = {
    visible,
    activeFocus,
    layout,
    interaction,
    nodeById,
    expandSubtree,
    expandCommunity,
    focus
  };
  useEffect(() => {
    const probe = densityProbe.current;
    if (!probe) return;
    const measure = () => {
      const width2 = probe.getBoundingClientRect().width;
      if (width2 > 0) setNodeMargin(width2);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)"), update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener?.("change", update);
    return () => preference.removeEventListener?.("change", update);
  }, []);
  useEffect(() => {
    controller?.setData(visible, { layout });
  }, [controller, visible, layout]);
  useEffect(() => {
    controller?.focusNode(activeFocus ?? null);
  }, [controller, activeFocus]);
  useEffect(() => {
    if (renderer === "svg") {
      setEngineState("fallback");
      return;
    }
    let active = true, engine;
    setEngineState("loading");
    void import("../../src/graph-engine.js").then(({ mountGraphEngine }) => {
      if (!active || !engineHost.current) return;
      const snapshot = latest.current;
      engine = mountGraphEngine(
        engineHost.current,
        snapshot.visible,
        (kind, id) => {
          const current = latest.current;
          current.interaction(kind, "click", id);
          if (kind !== "node") return;
          const node = current.nodeById(id);
          if (!node) return;
          if (node.collapsedSubtree)
            current.expandSubtree(node.collapsedSubtree);
          else if (node.collapsedCommunity)
            current.expandCommunity(node.collapsedCommunity);
          else current.focus(id);
        },
        { layout: snapshot.layout }
      );
      engine.focusNode(snapshot.activeFocus ?? null);
      setController(engine);
      setEngineState("ready");
    }).catch(() => {
      if (active) setEngineState("fallback");
    });
    return () => {
      active = false;
      engine?.destroy();
      setController(void 0);
    };
  }, [renderer]);
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "section",
    {
      ref: graphRoot,
      "data-ds-graph": true,
      "data-graph-layout": layout,
      "data-node-limit": detail.nodeLimit,
      "data-visible-node-count": visible.nodes.length,
      "data-engine-state": engineState,
      "data-node-margin": nodeMargin,
      "aria-label": label,
      className: `relative w-full min-w-0 overflow-hidden rounded-lg border border-muted bg-transparent text-foreground ${className}`.trim(),
      children: [
        /* @__PURE__ */ jsx(
          "span",
          {
            ref: densityProbe,
            "data-graph-density-probe": true,
            "aria-hidden": "true",
            className: "pointer-events-none invisible absolute start-0 top-0 h-0 w-[var(--reddb-spatial-gap-sm)]"
          }
        ),
        searchable ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
          "div",
          {
            className: "border-b border-muted p-[var(--reddb-spatial-inset-sm)]",
            children: [
              /* @__PURE__ */ jsx(
                Input,
                {
                  value: query,
                  onValueChange: setQuery,
                  type: "search",
                  "aria-label": `Search ${label}`,
                  placeholder: "Search nodes",
                  className: "w-full"
                }
              ),
              query ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                "div",
                {
                  "data-graph-search-results": true,
                  className: "mt-[var(--reddb-spatial-gap-sm)] flex flex-wrap gap-[var(--reddb-spatial-gap-sm)]",
                  children: results.length ? results.map((node, index) => {
                    return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                      ToggleButton,
                      {
                        label: node.label,
                        pressed: activeFocus === node.id,
                        allowUnpress: false,
                        onClick: () => focus(node.id)
                      }
                    ) }, node.id);
                  }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("span", { className: "text-sm text-ink-muted", children: "No matching nodes." }) })
                }
              ) }) : null
            ]
          }
        ) }) : null,
        /* @__PURE__ */ jsxs("div", { className: "relative w-full", style: { height: `${height}px` }, children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              ref: engineHost,
              "data-graph-engine": true,
              "aria-hidden": engineState !== "ready",
              className: [
                "absolute inset-0",
                engineState !== "ready" ? "invisible" : ""
              ].filter(Boolean).join(" ")
            }
          ),
          /* @__PURE__ */ jsxs(
            "svg",
            {
              "data-graph-fallback": "svg",
              role: "group",
              "aria-label": label,
              "aria-hidden": engineState === "ready",
              viewBox: `0 0 ${width} ${height}`,
              onClick: () => focus(null),
              className: [
                "h-full w-full bg-[var(--reddb-color-background)]",
                engineState === "ready" ? "invisible" : ""
              ].filter(Boolean).join(" "),
              children: [
                /* @__PURE__ */ jsx("title", { children: label }),
                focused.edges.map((edge, index) => {
                  const source = nodeById(edge.source);
                  const target = nodeById(edge.target);
                  return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                    "g",
                    {
                      "data-graph-edge": true,
                      "data-edge-id": edge.id,
                      role: "button",
                      tabIndex: 0,
                      "aria-label": edge.label ?? `${source.label} to ${target.label}`,
                      className: GRAPH_FOCUS_OUTLINE,
                      onClick: (event) => handleEdgeClick(event, edge.id),
                      onFocus: () => interaction("edge", "focus", edge.id),
                      onKeyDown: (event) => handleEdgeKeydown(event, edge.id),
                      children: /* @__PURE__ */ jsx(
                        "line",
                        {
                          x1: svgX(source),
                          y1: svgY(source),
                          x2: svgX(target),
                          y2: svgY(target),
                          stroke: edge.color,
                          strokeWidth: Math.max(1, edge.weight)
                        }
                      )
                    }
                  ) }, edge.id);
                }),
                focused.nodes.map((node, index) => {
                  return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx("g", { "data-graph-node": true, "data-focused": activeFocus === node.id, children: /* @__PURE__ */ jsx(
                    "circle",
                    {
                      "data-node-id": node.id,
                      "data-supernode-community": node.collapsedCommunity,
                      "data-summary-subtree": node.collapsedSubtree,
                      "data-summary-member-count": node.collapsedSubtree ? node.memberIds?.length : void 0,
                      "data-focus-pulse": activeFocus === node.id ? reducedMotion ? "held" : "active" : "none",
                      cx: svgX(node),
                      cy: svgY(node),
                      r: node.size * node.scale,
                      fill: node.color,
                      stroke: activeFocus === node.id ? "var(--reddb-color-foreground)" : "var(--reddb-color-background)",
                      strokeWidth: activeFocus === node.id ? 3 : 1,
                      role: "button",
                      tabIndex: 0,
                      "aria-label": `${node.label}, community ${node.community}`,
                      className: GRAPH_FOCUS_OUTLINE,
                      onClick: (event) => handleNodeClick(event, node.id),
                      onFocus: () => handleNodeFocus(node.id),
                      onKeyDown: (event) => handleNodeKeydown(event, node.id)
                    }
                  ) }) }, node.id);
                }),
                /* @__PURE__ */ jsx("g", { "data-graph-label-layer": true, "aria-hidden": "true", children: svgLabels.map((label2, index) => {
                  return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsx(
                    "text",
                    {
                      "data-graph-node-label": label2.nodeId,
                      "data-graph-edge-label": label2.edgeId,
                      x: label2.x,
                      y: label2.y,
                      textAnchor: "middle",
                      fill: "var(--reddb-color-foreground)",
                      className: "text-xs",
                      pointerEvents: "bounding-box",
                      children: label2.text
                    }
                  ) }, label2.key);
                }) })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsx(
          "ul",
          {
            "aria-label": "Graph communities",
            className: "m-0 flex list-none flex-wrap gap-[var(--reddb-spatial-gap-md)] border-t border-muted p-[var(--reddb-spatial-inset-sm)] text-sm",
            children: communities.map((community, index) => {
              return /* @__PURE__ */ jsx(Fragment2, { children: /* @__PURE__ */ jsxs(
                "li",
                {
                  className: "flex items-center gap-[var(--reddb-spatial-gap-sm)]",
                  children: [
                    /* @__PURE__ */ jsx(
                      "span",
                      {
                        "aria-hidden": "true",
                        className: "inline-block size-2 rounded-full",
                        style: { background: community.color }
                      }
                    ),
                    community.label,
                    " (",
                    community.nodes.length,
                    ") "
                  ]
                }
              ) }, community.id);
            })
          }
        ),
        showDetails && selectedInteraction ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
          "aside",
          {
            "data-graph-details": true,
            "aria-live": "polite",
            className: "border-t border-muted p-[var(--reddb-spatial-inset-sm)] text-sm",
            children: [
              /* @__PURE__ */ jsxs("strong", { children: [
                selectedInteraction.kind === "node" ? "Node" : "Edge",
                " ",
                selectedInteraction.id
              ] }),
              selectedInteraction.metadata ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                "pre",
                {
                  className: "mt-[var(--reddb-spatial-gap-sm)] overflow-auto whitespace-pre-wrap text-xs",
                  children: JSON.stringify(selectedInteraction.metadata, null, 2)
                }
              ) }) : /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
                "span",
                {
                  className: "ml-[var(--reddb-spatial-gap-sm)] text-ink-muted",
                  children: "No metadata"
                }
              ) })
            ]
          }
        ) }) : null
      ]
    }
  ) });
}
var Graph_default = Graph;
export {
  GRAPH_COLOR_TOKENS,
  GRAPH_EDGE_COLOR_TOKEN,
  GRAPH_EDGE_LABEL_MAX_LENGTH,
  GRAPH_ENGINE_STAGE_PADDING,
  GRAPH_FOCUSED_SCALE,
  GRAPH_FOCUS_PULSE_SCALE,
  GRAPH_LAYOUT_GRAVITY,
  GRAPH_LAYOUT_ITERATIONS_PER_NODE,
  GRAPH_LAYOUT_MAX_ITERATIONS,
  GRAPH_LAYOUT_MIN_AXIS_FILL,
  GRAPH_LAYOUT_MIN_ITERATIONS,
  GRAPH_LAYOUT_SCALING_RATIO,
  GRAPH_MUTED_COLOR_TOKEN,
  GRAPH_NEIGHBOUR_LABEL_LIMIT,
  GRAPH_NEIGHBOUR_SCALE,
  GRAPH_REST_SCALE,
  GRAPH_SUPERNODE_BASE_SIZE,
  GRAPH_SUPERNODE_MEMBER_SCALE,
  Graph,
  analyseGraphStructure,
  applyGraphLevelOfDetail2 as applyGraphLevelOfDetail,
  collapseGraphCommunities2 as collapseGraphCommunities,
  countGraphEdgeCrossings,
  countGraphNodeOverlapRatio,
  Graph_default as default,
  deriveGraphLevelOfDetail,
  detectGraphCommunities2 as detectGraphCommunities,
  filterGraphBackbone,
  graphNormalizedStress,
  groupGraphCommunities2 as groupGraphCommunities,
  layoutGraphByCentrality,
  layoutGraphBySparseStress2 as layoutGraphBySparseStress,
  partitionGraphByCentrality,
  rankGraphByBetweenness,
  reduceGraphFocus2 as reduceGraphFocus,
  searchGraphNodes2 as searchGraphNodes,
  shapeGraphData2 as shapeGraphData
};
