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
  return all;
}
export {
  treemapNodes
};
