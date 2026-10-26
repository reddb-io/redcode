import { unique } from "./visualization.js";
function diagramRanks(data) {
  unique(data.nodes, "Diagram nodes");
  unique(data.edges, "Diagram edges");
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const degree = new Map(data.nodes.map((n) => [n.id, 0]));
  const rank = new Map(data.nodes.map((n) => [n.id, 0]));
  for (const e of data.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) throw new Error("Unknown diagram node");
    degree.set(e.target, degree.get(e.target) + 1);
  }
  const queue = data.nodes.filter((n) => degree.get(n.id) === 0).map((n) => n.id);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const e of data.edges.filter((e2) => e2.source === id)) {
      rank.set(e.target, Math.max(rank.get(e.target), rank.get(id) + 1));
      degree.set(e.target, degree.get(e.target) - 1);
      if (degree.get(e.target) === 0) queue.push(e.target);
    }
  }
  let last = Math.max(-1, ...queue.map((id) => rank.get(id)));
  for (const n of data.nodes) if (degree.get(n.id) > 0) rank.set(n.id, ++last);
  const levels = Math.max(0, ...rank.values()) + 1;
  const counts = /* @__PURE__ */ new Map();
  for (const n of data.nodes) counts.set(rank.get(n.id), 1 + (counts.get(rank.get(n.id)) ?? 0));
  return { rank, counts, levels, lanes: Math.max(1, ...counts.values()) };
}
function diagramDimensions(data, direction = "right") {
  const { levels, lanes } = diagramRanks(data);
  const columns = direction === "right" ? levels : lanes;
  const rows = direction === "right" ? lanes : levels;
  return { widthUnits: columns * 5.5 + (columns - 1) * 3.5 + 2, heightUnits: rows * 2.25 + (rows - 1) * (direction === "right" ? 2 : 3.5) + 2 };
}
function diagramLayout(data, width, height, direction = "right", unit = 32) {
  const { rank, counts, levels } = diagramRanks(data);
  const dimensions = diagramDimensions(data, direction);
  const nodeWidth = unit * 5.5, nodeHeight = unit * 2.25;
  const drawingWidth = dimensions.widthUnits * unit, drawingHeight = dimensions.heightUnits * unit;
  const offsetX = Math.max(0, (width - drawingWidth) / 2) + unit;
  const offsetY = Math.max(0, (height - drawingHeight) / 2) + unit;
  const index = /* @__PURE__ */ new Map();
  const nodes = data.nodes.map((n) => {
    const r = rank.get(n.id), i = index.get(r) ?? 0;
    index.set(r, i + 1);
    const count = counts.get(r);
    const main = r * (direction === "right" ? nodeWidth + unit * 3.5 : nodeHeight + unit * 3.5);
    const cross = (i - (count - 1) / 2) * (direction === "right" ? nodeHeight + unit * 2 : nodeWidth + unit * 3.5);
    return {
      ...n,
      width: nodeWidth,
      height: nodeHeight,
      x: offsetX + (direction === "right" ? main + nodeWidth / 2 : drawingWidth / 2 - unit + cross),
      y: offsetY + (direction === "right" ? drawingHeight / 2 - unit + cross : main + nodeHeight / 2)
    };
  });
  return { nodes, edges: data.edges, levels };
}
function diagramConnection(a, b, direction, unit) {
  const right = direction === "right";
  const backward = right ? b.x <= a.x : b.y <= a.y;
  if (backward) {
    const sx2 = a.x - (right ? 0 : a.width / 2), sy2 = a.y - (right ? a.height / 2 : 0);
    const tx2 = b.x - (right ? 0 : b.width / 2), ty2 = b.y - (right ? b.height / 2 : 0);
    const rail = right ? Math.min(sy2, ty2) - unit / 2 : Math.min(sx2, tx2) - unit / 2;
    return {
      path: right ? `M${sx2},${sy2} V${rail} H${tx2} V${ty2}` : `M${sx2},${sy2} H${rail} V${ty2} H${tx2}`,
      arrow: right ? `M${tx2 - 4},${ty2 - 6} L${tx2},${ty2} L${tx2 + 4},${ty2 - 6}` : `M${tx2 - 6},${ty2 - 4} L${tx2},${ty2} L${tx2 - 6},${ty2 + 4}`,
      labelX: right ? (sx2 + tx2) / 2 : rail,
      labelY: right ? rail + 14 : (sy2 + ty2) / 2 - 10,
      labelAnchor: "middle"
    };
  }
  const sx = a.x + (right ? a.width / 2 : 0), sy = a.y + (right ? 0 : a.height / 2);
  const tx = b.x - (right ? b.width / 2 : 0), ty = b.y - (right ? 0 : b.height / 2);
  const mid = right ? (sx + tx) / 2 : (sy + ty) / 2;
  const r = Math.min(unit / 4, Math.abs(right ? ty - sy : tx - sx) / 2);
  const sign = Math.sign(right ? ty - sy : tx - sx);
  return {
    path: right ? `M${sx},${sy} H${mid - r} Q${mid},${sy} ${mid},${sy + sign * r} V${ty - sign * r} Q${mid},${ty} ${mid + r},${ty} H${tx}` : `M${sx},${sy} V${mid - r} Q${sx},${mid} ${sx + sign * r},${mid} H${tx - sign * r} Q${tx},${mid} ${tx},${mid + r} V${ty}`,
    arrow: right ? `M${tx - 6},${ty - 4} L${tx},${ty} L${tx - 6},${ty + 4}` : `M${tx - 4},${ty - 6} L${tx},${ty} L${tx + 4},${ty - 6}`,
    labelX: right ? sy === ty ? (sx + tx) / 2 : tx - 10 : sx === tx ? sx + unit / 2 : (sx + tx) / 2,
    labelY: right ? ty - 12 : sx === tx ? (sy + ty) / 2 + 4 : mid - 12,
    labelAnchor: right && sy !== ty ? "end" : !right && sx === tx ? "start" : "middle"
  };
}
export {
  diagramConnection,
  diagramDimensions,
  diagramLayout,
  diagramRanks
};
