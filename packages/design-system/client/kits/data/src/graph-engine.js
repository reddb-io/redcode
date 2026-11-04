import {
  graphOverlays,
  graphPath
} from "./graph-overlays.js";
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
function mountGraphEngine(host, initialData, interact, initialOptions = { layout: "stress" }) {
  let colors = resolveColors(host);
  let options = initialOptions;
  let overlays = graphOverlays(initialData, options);
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
    enableEdgeEvents: true,
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
      if (overlays.paths.has(id)) return { ...attributes, hidden: true };
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
  const ns = "http://www.w3.org/2000/svg";
  const overlay = document.createElementNS(ns, "svg");
  overlay.setAttribute("data-graph-overlay", "canvas");
  overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden";
  host.append(overlay);
  let boxElements = [];
  let edgeElements = [];
  const project = (point) => renderer.graphToViewport(point);
  function projectOverlay() {
    const { width, height } = renderer.getDimensions();
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    for (const { box, rect, text } of boxElements) {
      const corners = [
        project({ x: box.minX, y: box.minY }),
        project({ x: box.maxX, y: box.maxY }),
        project({ x: box.minX, y: box.maxY }),
        project({ x: box.maxX, y: box.minY })
      ];
      const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys);
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(Math.max(...xs) - x));
      rect.setAttribute("height", String(Math.max(...ys) - y));
      text.setAttribute("x", String(x));
      text.setAttribute("y", String(y));
    }
    for (const { points, path } of edgeElements)
      path.setAttribute("d", graphPath(points, project));
  }
  function rebuildOverlay() {
    overlay.replaceChildren();
    boxElements = [];
    edgeElements = [];
    for (const box of overlays.boxes) {
      const rect = document.createElementNS(ns, "rect"), text = document.createElementNS(ns, "text");
      rect.setAttribute("fill", box.color);
      rect.style.fillOpacity = ".08";
      rect.setAttribute("stroke", box.color);
      rect.style.strokeOpacity = ".5";
      rect.setAttribute("aria-hidden", "true");
      text.setAttribute("fill", "var(--reddb-color-foreground)");
      text.setAttribute("class", "text-xs");
      text.setAttribute("aria-hidden", "true");
      text.textContent = `${box.id} (${box.count})`;
      overlay.append(rect, text);
      boxElements.push({ box, rect, text });
    }
    for (const edge of data.edges) {
      const points = overlays.paths.get(edge.id);
      if (!points) continue;
      const path = document.createElementNS(ns, "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", edge.color);
      path.style.strokeWidth = String(Math.max(1, edge.weight));
      path.setAttribute("role", "button");
      path.setAttribute("tabindex", "0");
      path.setAttribute(
        "aria-label",
        edge.label ?? `${edge.source} to ${edge.target}`
      );
      path.setAttribute(
        "class",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      );
      path.dataset.edgeId = edge.id;
      path.style.pointerEvents = "stroke";
      path.addEventListener("click", (event) => {
        event.stopPropagation();
        interact?.("edge", edge.id);
      });
      path.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          interact?.("edge", edge.id);
        }
      });
      overlay.append(path);
      edgeElements.push({ id: edge.id, points, path });
    }
    projectOverlay();
  }
  renderer.on("afterRender", projectOverlay);
  rebuildOverlay();
  const canvases = renderer.getCanvases();
  if (canvases.edgeLabels && canvases.labels) {
    canvases.labels.before(canvases.edgeLabels);
  }
  const updateFocusState = (pulseProgress = 0, preview = focusedNode) => {
    const focus = reduceGraphFocus(data, preview, pulseProgress);
    focusedNodes = new Map(focus.nodes.map((node) => [node.id, node]));
    focusedEdges = new Map(focus.edges.map((edge) => [edge.id, edge]));
    for (const { id, path } of edgeElements) {
      const edge = focusedEdges.get(id);
      if (edge) path.setAttribute("stroke", edge.color);
    }
  };
  const applyFocus = (id) => {
    if (pulseFrame !== void 0) cancelAnimationFrame(pulseFrame);
    pulseFrame = void 0;
    focusedNode = id !== null && graph.hasNode(id) ? id : null;
    updateFocusState();
    renderer.refresh();
  };
  const pulse = (id) => {
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      return;
    if (pulseFrame !== void 0) cancelAnimationFrame(pulseFrame);
    const started = performance.now();
    const frame = (now) => {
      const progress = Math.min(1, (now - started) / 420);
      updateFocusState(Math.sin(progress * Math.PI));
      renderer.refresh();
      if (progress < 1 && focusedNode === id)
        pulseFrame = requestAnimationFrame(frame);
      else {
        pulseFrame = void 0;
        updateFocusState();
        renderer.refresh();
      }
    };
    pulseFrame = requestAnimationFrame(frame);
  };
  renderer.on("enterNode", ({ node }) => {
    if (!focusedNode) {
      updateFocusState(0, node);
      renderer.refresh();
    }
  });
  renderer.on("leaveNode", () => {
    if (!focusedNode) {
      updateFocusState();
      renderer.refresh();
    }
  });
  renderer.on("clickNode", ({ node }) => interact?.("node", node));
  renderer.on("clickEdge", ({ edge }) => interact?.("edge", edge));
  applyFocus(null);
  return {
    destroy: () => {
      if (pulseFrame !== void 0) cancelAnimationFrame(pulseFrame);
      renderer.off("afterRender", projectOverlay);
      overlay.remove();
      renderer.kill();
    },
    zoom: (ratio) => renderer.getCamera().setState({ ratio: Math.max(0.125, Math.min(2, ratio)) }),
    fit: () => renderer.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }),
    focusNode: (id) => {
      applyFocus(id);
      if (!focusedNode) return;
      const position = renderer.getNodeDisplayData(focusedNode);
      if (position) {
        const target = { x: position.x, y: position.y, ratio: 0.35 };
        if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
          renderer.getCamera().setState(target);
        else renderer.getCamera().animate(target, { duration: 300 });
      }
      pulse(focusedNode);
    },
    setData: (nextData, nextOptions) => {
      options = nextOptions ?? options;
      overlays = graphOverlays(nextData, options);
      colors = resolveColors(host);
      layout = replaceGraphData(graph, nextData, colors);
      data = layout;
      rebuildOverlay();
      applyFocus(focusedNode);
    }
  };
}
export {
  mountGraphEngine
};
