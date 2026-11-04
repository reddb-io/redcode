import { bundleEdges, BUNDLE_EDGE_LIMIT } from "./graph-edge-bundling.js";
function exitPoint(p, q, box) {
  const dx = q.x - p.x, dy = q.y - p.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (box.maxX - p.x) / dx);
  else if (dx < 0) t = Math.min(t, (box.minX - p.x) / dx);
  if (dy > 0) t = Math.min(t, (box.maxY - p.y) / dy);
  else if (dy < 0) t = Math.min(t, (box.minY - p.y) / dy);
  t = Math.max(0, Math.min(1, t));
  return { x: p.x + dx * t, y: p.y + dy * t };
}
function graphOverlays(data, options) {
  const boxes = /* @__PURE__ */ new Map(), paths = /* @__PURE__ */ new Map(), nodes = new Map(data.nodes.map((node) => [node.id, node]));
  if (options.grouped) {
    for (const node of data.nodes) {
      const box = boxes.get(node.community);
      if (box) {
        box.count++;
        box.minX = Math.min(box.minX, node.x);
        box.maxX = Math.max(box.maxX, node.x);
        box.minY = Math.min(box.minY, node.y);
        box.maxY = Math.max(box.maxY, node.y);
      } else
        boxes.set(node.community, {
          id: node.community,
          count: 1,
          color: node.color,
          minX: node.x,
          maxX: node.x,
          minY: node.y,
          maxY: node.y
        });
    }
    for (const box of boxes.values()) {
      box.minX -= 0.05;
      box.minY -= 0.05;
      box.maxX += 0.05;
      box.maxY += 0.05;
    }
    for (const edge of data.edges) {
      const from = nodes.get(edge.source), to = nodes.get(edge.target);
      if (from && to && from.community !== to.community)
        paths.set(edge.id, [
          exitPoint(from, to, boxes.get(from.community)),
          exitPoint(to, from, boxes.get(to.community))
        ]);
    }
  }
  const bundleSkipped = !!options.bundled && data.edges.length > BUNDLE_EDGE_LIMIT;
  if (options.bundled && !bundleSkipped) {
    const bundled = bundleEdges(
      data.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
      [...data.edges],
      {
        cycles: 4,
        iterations: data.edges.length > 700 ? 12 : 25,
        stepSize: 0.02
      }
    );
    for (const [id, points] of bundled)
      if (!paths.has(id)) paths.set(id, points);
  }
  return { boxes: [...boxes.values()], paths, bundleSkipped };
}
function graphPath(points, project) {
  return points.map((point, index) => {
    const p = project(point);
    return `${index ? "L" : "M"}${p.x},${p.y}`;
  }).join(" ");
}
export {
  graphOverlays,
  graphPath
};
