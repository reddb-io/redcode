import { automaticChartPalette, chartColorToken } from "./core/chart-color.js";
import { finite, unique } from "./visualization.js";
function treemapNodes(data) {
  const all = [], active = /* @__PURE__ */ new Set();
  function visit(node) {
    if (active.has(node)) throw new Error("Cyclic treemap hierarchy");
    active.add(node);
    all.push(node);
    if (node.value !== void 0 && finite(node.value, node.id) < 0) throw new Error("Treemap values must be non-negative");
    for (const c of node.children ?? []) visit(c);
    active.delete(node);
  }
  visit(data);
  unique(all, "Treemap");
  const automatic = automaticChartPalette(all.filter((node) => !node.children?.length));
  const copies = new Map(all.map((node) => [node.id, { ...node, color: chartColorToken(node, void 0, automatic) }]));
  for (const node of all) if (node.children) copies.get(node.id).children = node.children.map((child) => copies.get(child.id));
  return all.map((node) => copies.get(node.id));
}
export {
  treemapNodes
};
