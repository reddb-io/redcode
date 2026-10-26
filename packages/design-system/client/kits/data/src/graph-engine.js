import Graphology from "graphology";
import Sigma from "sigma";
import {
  GRAPH_EDGE_COLOR_TOKEN,
  GRAPH_ENGINE_STAGE_PADDING,
  reduceGraphFocus
} from "./graph.js";
function cssTokenName(token) {
  return /^var\((--[^)]+)\)$/.exec(token)?.[1];
}
function resolveColors(host) {
  const style = getComputedStyle(host);
  const resolve = (token, fallback) => {
    const name = cssTokenName(token);
    return (name ? style.getPropertyValue(name).trim() : "") || fallback;
  };
  const ink = style.color;
  return {
    background: resolve("var(--reddb-color-background)", "transparent"),
    foreground: resolve("var(--reddb-color-foreground)", ink),
    edge: resolve(GRAPH_EDGE_COLOR_TOKEN, ink),
    token: (token) => resolve(token, ink)
  };
}
function replaceGraphData(graph, data, colors) {
  graph.clear();
  for (const node of data.nodes) {
    graph.addNode(node.id, {
      label: node.label,
      x: node.x,
      y: node.y,
      size: node.size,
      color: colors.token(node.color),
      community: node.community
    });
  }
  for (const edge of data.edges) {
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      label: edge.label,
      size: Math.max(1, edge.weight),
      weight: edge.weight,
      color: colors.token(edge.color)
    });
  }
  return {
    nodes: data.nodes.map((node) => {
      const attributes = graph.getNodeAttributes(node.id);
      return {
        ...node,
        x: Number(attributes.x),
        y: Number(attributes.y),
        community: String(attributes.community)
      };
    }),
    edges: data.edges
  };
}
function mountGraphEngine(host, initialData, interact, _initialOptions = { layout: "stress" }) {
  const colors = resolveColors(host);
  const graph = new Graphology({ type: "undirected", multi: true });
  let data = initialData;
  let focusedNode = null;
  let focusedNodes = /* @__PURE__ */ new Map();
  let focusedEdges = /* @__PURE__ */ new Map();
  let pulseFrame;
  let layout = replaceGraphData(graph, initialData, colors);
  data = layout;
  const renderer = new Sigma(graph, host, {
    defaultEdgeColor: colors.edge,
    defaultNodeColor: colors.foreground,
    renderEdgeLabels: true,
    labelColor: { color: colors.foreground },
    nodeReducer: (id, attributes) => {
      const node = focusedNodes.get(id);
      if (!node) return attributes;
      return {
        ...attributes,
        color: colors.token(node.color),
        forceLabel: node.id === focusedNode,
        label: node.showLabel ? node.label : "",
        size: node.size * node.scale
      };
    },
    edgeReducer: (id, attributes) => {
      const edge = focusedEdges.get(id);
      if (!edge) return attributes;
      return {
        ...attributes,
        color: colors.token(edge.color),
        forceLabel: edge.displayLabel !== void 0,
        label: edge.displayLabel ?? ""
      };
    },
    stagePadding: GRAPH_ENGINE_STAGE_PADDING
  });
  const canvases = renderer.getCanvases();
  if (canvases.edgeLabels && canvases.labels) {
    canvases.labels.before(canvases.edgeLabels);
  }
  const updateFocusState = (pulseProgress = 0) => {
    const focus = reduceGraphFocus(data, focusedNode, pulseProgress);
    focusedNodes = new Map(focus.nodes.map((node) => [node.id, node]));
    focusedEdges = new Map(focus.edges.map((edge) => [edge.id, edge]));
  };
  const applyFocus = (id) => {
    if (pulseFrame !== void 0) cancelAnimationFrame(pulseFrame);
    pulseFrame = void 0;
    focusedNode = id !== null && graph.hasNode(id) ? id : null;
    updateFocusState();
    renderer.refresh();
  };
  const pulse = (id) => {
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (pulseFrame !== void 0) cancelAnimationFrame(pulseFrame);
    const started = performance.now();
    const frame = (now) => {
      const progress = Math.min(1, (now - started) / 420);
      updateFocusState(Math.sin(progress * Math.PI));
      renderer.refresh();
      if (progress < 1 && focusedNode === id) pulseFrame = requestAnimationFrame(frame);
      else {
        pulseFrame = void 0;
        updateFocusState();
        renderer.refresh();
      }
    };
    pulseFrame = requestAnimationFrame(frame);
  };
  renderer.on("clickNode", ({ node }) => interact?.("node", node));
  renderer.on("clickEdge", ({ edge }) => interact?.("edge", edge));
  applyFocus(null);
  return {
    destroy: () => {
      if (pulseFrame !== void 0) cancelAnimationFrame(pulseFrame);
      renderer.kill();
    },
    focusNode: (id) => {
      applyFocus(id);
      if (!focusedNode) return;
      const { x, y } = graph.getNodeAttributes(focusedNode);
      renderer.getCamera().animate({ x, y, ratio: 0.35 }, { duration: 300 });
      pulse(focusedNode);
    },
    setData: (nextData) => {
      layout = replaceGraphData(graph, nextData, colors);
      data = layout;
      applyFocus(focusedNode);
    }
  };
}
export {
  mountGraphEngine
};
