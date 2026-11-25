import { automaticChartColors } from "./core/chart-color.js";
import { finite, unique } from "./visualization.js";
function sankeyData(data) {
  unique(data.nodes, "Sankey nodes");
  unique(data.links, "Sankey links");
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const outgoing = /* @__PURE__ */ new Map();
  for (const link of data.links) {
    if (!byId.has(link.source) || !byId.has(link.target)) throw new Error("Sankey references an unknown node");
    if (finite(link.value, link.id) < 0) throw new Error("Sankey weights must be non-negative");
    outgoing.set(link.source, [...outgoing.get(link.source) ?? [], link.target]);
  }
  const active = /* @__PURE__ */ new Set(), done = /* @__PURE__ */ new Set();
  function visit(id) {
    if (active.has(id)) throw new Error("Sankey requires an acyclic flow; represent retries as separate stages");
    if (done.has(id)) return;
    active.add(id);
    for (const next of outgoing.get(id) ?? []) visit(next);
    active.delete(id);
    done.add(id);
  }
  for (const node of data.nodes) visit(node.id);
  const links = data.links.filter((l) => l.value > 0).map((l) => ({ ...l }));
  const used = new Set(links.flatMap((l) => [l.source, l.target]));
  return { nodes: automaticChartColors(data.nodes).filter((n) => used.has(n.id)), links };
}
function sankeyRows(data, format) {
  const label = (id) => data.nodes.find((n) => n.id === id)?.label;
  const flows = data.links.map((l) => ({ ...l, value: format(l.value), description: `${label(l.source)} \u2192 ${label(l.target)}` }));
  const drawn = data.links.filter((l) => l.value > 0);
  const throughput = (id) => Math.max(...["source", "target"].map((end) => drawn.filter((l) => l[end] === id).reduce((sum, l) => sum + l.value, 0)));
  const stages = data.nodes.filter((n) => drawn.some((l) => l.source === n.id || l.target === n.id)).map((n) => ({ id: n.id, label: n.label, value: format(throughput(n.id)) }));
  return [...flows, ...stages];
}
export {
  sankeyData,
  sankeyRows
};
